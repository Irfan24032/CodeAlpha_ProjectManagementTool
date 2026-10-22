# CodeAlpha Task 3 — ProjectFlow

A beginner-friendly project management app built with HTML, CSS, JavaScript, Node.js, Express, SQLite, sessions, bcrypt password hashing, and Socket.IO refresh events.

## Run in VS Code (Windows)

1. Extract `Task3_ProjectManagement.zip`.
2. In VS Code, choose **File → Open Folder** and select `Task3_ProjectManagement`.
3. Open **Terminal → New Terminal**. Confirm the prompt ends with `Task3_ProjectManagement`.
4. Run:
   ```bash
   npm install
   npm start
   ```
5. Open **http://localhost:3001**.

## Try it
- Register an account (username 3+ characters; password 6+ characters).
- Create a project and add tasks.
- Change tasks between Todo, In Progress, and Done.
- Open Comments on a task to add comments.
- Register another user in a second browser/incognito window, then use Invite member to add them by username.

## Features
- Account registration/login with bcrypt-hashed passwords
- Project creation and membership
- Task cards, priorities, due dates, and status columns
- Task comments
- SQLite persistence
- Responsive modern dashboard
- Socket.IO refresh notifications for project activity

## Notes
This is an educational local demo, not production-hardened. For deployment, configure a strong SESSION_SECRET, persistent secure session storage, HTTPS, CSRF protection, rate limits, validation, and authorization tests. Socket.IO events are a demo-level refresh mechanism; validate membership for real production socket events.
