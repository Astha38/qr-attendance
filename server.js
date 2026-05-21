const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const cors = require("cors");
const path = require("path");
const db = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Mock User Database
const USERS = {
  teachers: {
    teacher1: "pass123",
    astha492: "123"
  },
  students: { alice: "student1", bob: "student2", charlie: "student3" },
};

// --- Auth Middleware ---
function authTeacher(req, res, next) {
  const { username, password } = req.headers;
  if (username && password && USERS.teachers[username] === password) return next();
  res.status(401).json({ error: "Unauthorized teacher" });
}

function authStudent(req, res, next) {
  const { username, password } = req.headers;
  if (username && password && USERS.students[username] === password) return next();
  res.status(401).json({ error: "Unauthorized student" });
}

const makeToken = () => Math.random().toString(36).substring(2, 10).toUpperCase();

// --- Routes ---
app.get("/", (req, res) => res.redirect("/teacher.html"));

// API: Verify Student Login
app.post("/api/student/login", (req, res) => {
  const { username, password } = req.body;
  if (username && password && USERS.students[username] === password) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Unauthorized student" });
  }
});

// API: Create Session
app.post("/api/session/create", authTeacher, async (req, res) => {
  const { class_name } = req.body;
  const teacher_username = req.headers.username;
  const token = makeToken();

  const sql = "INSERT INTO sessions (class_name, token, teacher_username, is_active) VALUES (?, ?, ?, 0)";
  db.run(sql, [class_name, token, teacher_username], async function (err) {
    if (err) return res.status(500).json({ error: err.message });

    const sessionId = this.lastID;
    const qrData = JSON.stringify({ sessionId, token });
    const qrImage = await QRCode.toDataURL(qrData);
    res.json({ sessionId, token, qrImage });
  });
});

// API: Mark Attendance
app.post("/api/attend", authStudent, (req, res) => {
  const { sessionId, token } = req.body;
  const studentName = req.headers.username;

  if (!studentName || studentName.trim() === "") {
    return res.status(400).json({ error: "Student name cannot be empty." });
  }

  db.get("SELECT * FROM sessions WHERE id = ?", [sessionId], (err, session) => {
    if (err || !session) {
      return res.status(400).json({ error: "Invalid session." });
    }
    
    if (session.is_active === 0) {
      return res.status(400).json({ error: "Session is not active right now. Please wait for the teacher to start it." });
    }

    if (session.token !== token) {
      return res.status(400).json({ error: "Invalid or expired QR code." });
    }

    db.run("INSERT INTO attendance (session_id, student_name) VALUES (?, ?)", [sessionId, studentName], function(err) {
      if (err) {
        if (err.message.includes("UNIQUE")) {
          return res.status(409).json({ error: "Attendance already marked for this session." });
        }
        return res.status(500).json({ error: "Database error." });
      }

      const timestamp = Math.floor(Date.now() / 1000); // Provide timestamp here for immediate use

      // Emit to teacher via socket.io
      io.to(`session_${sessionId}`).emit("student_attended", {
        student_name: studentName,
        timestamp: timestamp
      });

      res.json({ 
        success: true, 
        message: "Attendance marked successfully!",
        sessionDetails: {
          className: session.class_name,
          teacherUsername: session.teacher_username,
          createdAt: session.created_at
        }
      });
    });
  });
});

// --- Socket.io Logic ---
const activeIntervals = {};

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join_session", (data) => {
    const { sessionId, username, password } = data;
    // Basic auth check for sockets (optional but good for security)
    if (USERS.teachers[username] === password) {
      socket.join(`session_${sessionId}`);
      console.log(`Teacher ${username} joined session room ${sessionId}`);
      
      // Send current attendance history to teacher immediately
      db.all("SELECT student_name, COALESCE(timestamp, marked_at) as timestamp FROM attendance WHERE session_id = ?", [sessionId], (err, rows) => {
        if (!err && rows) {
          socket.emit("attendance_history", rows);
        }
      });
    }
  });

  socket.on("start_session", async (data) => {
    const { sessionId, username, password } = data;
    if (USERS.teachers[username] !== password) return;

    db.run("UPDATE sessions SET is_active = 1 WHERE id = ?", [sessionId]);
    console.log(`Session ${sessionId} started.`);

    // Clear any existing interval
    if (activeIntervals[sessionId]) {
      clearInterval(activeIntervals[sessionId]);
    }

    // Function to rotate token
    const rotateToken = async () => {
      const newToken = makeToken();
      db.run("UPDATE sessions SET token = ? WHERE id = ?", [newToken, sessionId], async (err) => {
        if (!err) {
          const qrData = JSON.stringify({ sessionId, token: newToken });
          const qrImage = await QRCode.toDataURL(qrData);
          io.to(`session_${sessionId}`).emit("new_token", { qrImage });
        }
      });
    };

    // Rotate immediately then every 30 seconds
    rotateToken();
    activeIntervals[sessionId] = setInterval(rotateToken, 30000);
    
    socket.emit("session_status", { isActive: true });
  });

  socket.on("stop_session", (data) => {
    const { sessionId, username, password } = data;
    if (USERS.teachers[username] !== password) return;

    db.run("UPDATE sessions SET is_active = 0 WHERE id = ?", [sessionId]);
    console.log(`Session ${sessionId} stopped.`);

    if (activeIntervals[sessionId]) {
      clearInterval(activeIntervals[sessionId]);
      delete activeIntervals[sessionId];
    }
    
    socket.emit("session_status", { isActive: false });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
