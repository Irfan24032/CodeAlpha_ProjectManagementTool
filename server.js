const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database('project-management.sqlite');
const PORT = process.env.PORT || 3001;

db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', owner_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS project_members (project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, UNIQUE(project_id,user_id));
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Todo', priority TEXT NOT NULL DEFAULT 'Normal', assignee_id INTEGER, created_by INTEGER NOT NULL, due_date TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: process.env.SESSION_SECRET || 'change-this-local-demo-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax' } }));

function auth(req,res,next){ if(!req.session.userId) return res.status(401).json({error:'Please log in first.'}); next(); }
function member(req,res,next){
  const projectId = Number(req.params.projectId || req.body.projectId);
  if(!projectId) return res.status(400).json({error:'Project ID is required.'});
  const ok = db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(projectId, req.session.userId);
  if(!ok) return res.status(403).json({error:'You are not a member of this project.'});
  req.projectId = projectId; next();
}
app.post('/api/register', async (req,res)=>{
  const username = String(req.body.username||'').trim();
  const password = String(req.body.password||'');
  if(username.length < 3 || password.length < 6) return res.status(400).json({error:'Username must be 3+ characters and password 6+ characters.'});
  try {
    const result = db.prepare('INSERT INTO users(username,password_hash) VALUES(?,?)').run(username, await bcrypt.hash(password,10));
    req.session.userId = result.lastInsertRowid;
    req.session.username = username;
    res.json({id:result.lastInsertRowid, username});
  } catch { res.status(409).json({error:'That username is already taken.'}); }
});
app.post('/api/login', async (req,res)=>{
  const username = String(req.body.username||'').trim();
  const row = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if(!row || !(await bcrypt.compare(String(req.body.password||''),row.password_hash))) return res.status(401).json({error:'Invalid username or password.'});
  req.session.userId=row.id; req.session.username=row.username; res.json({id:row.id,username:row.username});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>res.json(req.session.userId?{id:req.session.userId,username:req.session.username}:null));

app.get('/api/projects',auth,(req,res)=>{
  res.json(db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) task_count
    FROM projects p JOIN project_members pm ON pm.project_id=p.id WHERE pm.user_id=? ORDER BY p.id DESC`).all(req.session.userId));
});
app.post('/api/projects',auth,(req,res)=>{
  const name=String(req.body.name||'').trim(), description=String(req.body.description||'').trim();
  if(!name) return res.status(400).json({error:'Project name is required.'});
  const info=db.prepare('INSERT INTO projects(name,description,owner_id) VALUES(?,?,?)').run(name,description,req.session.userId);
  db.prepare('INSERT INTO project_members(project_id,user_id) VALUES(?,?)').run(info.lastInsertRowid,req.session.userId);
  res.json({id:info.lastInsertRowid,name,description});
});
app.post('/api/projects/:projectId/members',auth,member,(req,res)=>{
  const username=String(req.body.username||'').trim();
  const user=db.prepare('SELECT id,username FROM users WHERE username=?').get(username);
  if(!user) return res.status(404).json({error:'No account found for that username. Ask them to register first.'});
  db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id) VALUES(?,?)').run(req.projectId,user.id);
  res.json({ok:true,username:user.username});
});
app.get('/api/projects/:projectId/tasks',auth,member,(req,res)=>{
  res.json(db.prepare(`SELECT t.*, u.username assignee_name, creator.username creator_name FROM tasks t
    JOIN users creator ON creator.id=t.created_by LEFT JOIN users u ON u.id=t.assignee_id
    WHERE t.project_id=? ORDER BY CASE t.status WHEN 'In Progress' THEN 1 WHEN 'Done' THEN 2 ELSE 0 END, t.id DESC`).all(req.projectId));
});
app.post('/api/projects/:projectId/tasks',auth,member,(req,res)=>{
  const title=String(req.body.title||'').trim();
  if(!title) return res.status(400).json({error:'Task title is required.'});
  const info=db.prepare('INSERT INTO tasks(project_id,title,description,status,priority,created_by,due_date) VALUES(?,?,?,?,?,?,?)')
    .run(req.projectId,title,String(req.body.description||''),'Todo', ['Low','Normal','High'].includes(req.body.priority)?req.body.priority:'Normal',req.session.userId,String(req.body.due_date||''));
  io.to('project:'+req.projectId).emit('refresh');
  res.json({id:info.lastInsertRowid});
});
app.patch('/api/tasks/:taskId',auth,(req,res)=>{
  const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(req.params.taskId));
  if(!task) return res.status(404).json({error:'Task not found.'});
  if(!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(task.project_id,req.session.userId)) return res.status(403).json({error:'Not allowed.'});
  const status=['Todo','In Progress','Done'].includes(req.body.status)?req.body.status:task.status;
  const priority=['Low','Normal','High'].includes(req.body.priority)?req.body.priority:task.priority;
  db.prepare('UPDATE tasks SET status=?,priority=? WHERE id=?').run(status,priority,task.id);
  io.to('project:'+task.project_id).emit('refresh');
  res.json({ok:true});
});
app.get('/api/tasks/:taskId/comments',auth,(req,res)=>{
  const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(req.params.taskId));
  if(!task) return res.status(404).json({error:'Task not found.'});
  if(!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(task.project_id,req.session.userId)) return res.status(403).json({error:'Not allowed.'});
  res.json(db.prepare('SELECT c.*,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE task_id=? ORDER BY c.id').all(task.id));
});
app.post('/api/tasks/:taskId/comments',auth,(req,res)=>{
  const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(req.params.taskId));
  const body=String(req.body.body||'').trim();
  if(!task) return res.status(404).json({error:'Task not found.'});
  if(!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(task.project_id,req.session.userId)) return res.status(403).json({error:'Not allowed.'});
  if(!body) return res.status(400).json({error:'Comment cannot be empty.'});
  db.prepare('INSERT INTO comments(task_id,user_id,body) VALUES(?,?,?)').run(task.id,req.session.userId,body);
  io.to('project:'+task.project_id).emit('refresh');
  res.json({ok:true});
});
io.on('connection',socket=>{
  socket.on('join-project', projectId=>{
    const id=Number(projectId);
    if(!socket.request.session) return;
    socket.join('project:'+id);
  });
});
// Make the session available to Socket.IO too.
const sessionMiddleware = session({ secret: process.env.SESSION_SECRET || 'change-this-local-demo-secret', resave:false, saveUninitialized:false });
io.use((socket,next)=>{ next(); });
server.listen(PORT,()=>console.log(`ProjectFlow running at http://localhost:${PORT}`));
