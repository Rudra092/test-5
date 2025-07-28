const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
// Setup Express + HTTP + Socket.IO
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

app.use(cors({ origin: '*' })); // allow requests from any origin
app.use(express.json());

let onlineUsers = {};

io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);

  // When user logs in and sends their name
  socket.on('user-connected', (user) => {
    onlineUsers[socket.id] = user;
    io.emit('online-users', Object.values(onlineUsers));
  });

  // When user sends a message
  socket.on('chat-message', (msg) => {
    io.emit('chat-message', msg); // broadcast to all
  });

  // When user disconnects
  socket.on('disconnect', () => {
    delete onlineUsers[socket.id];
    io.emit('online-users', Object.values(onlineUsers));
  });
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// User model
const User = mongoose.model('User', new mongoose.Schema({
  username: String,
  password: String,
  email: String,
  fullname: String,
  phone: String
}));

// In-memory OTP store (use DB or Redis in production)
const otps = {};

// Nodemailer setup (Gmail App Passwords required)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 🔐 Register
app.post('/register', async (req, res) => {
  const { username, email, password, fullname, phone } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    return res.status(400).json({ success: false, message: 'User already exists' });
  }

  const user = new User({ username, email, password, fullname, phone });
  await user.save();

  res.json({ success: true, message: 'Registered successfully!' });
});

// 🔐 Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const found = await User.findOne({ username, password });

if (found) {
  res.json({
    success: true,
    message: 'Login successful!',
    user: found
  });
}
 else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 📧 Request OTP
app.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps[email] = otp;

  try {
    await transporter.sendMail({
      from: `"My App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset OTP',
      html: `<p>Your OTP is: <strong>${otp}</strong></p>`
    });

    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// ✅ Verify OTP
app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;

  if (otps[email] === otp) {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Invalid OTP' });
  }
});

// 🔁 Reset Password
app.post('/reset-password', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOneAndUpdate({ email }, { password });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    delete otps[email];
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

// ✅ Fetch current user by ID
app.get('/me/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id, '-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ✅ Update user profile
app.put('/update-profile/:id', async (req, res) => {
  const { fullname, email, phone } = req.body;
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { fullname, email, phone }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'Profile updated!', user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

const PORT = process.env.PORT || 3000;
// Use this instead of app.listen
server.listen(PORT, () => console.log(`🚀 Server running with socket.io on port ${PORT}`));
