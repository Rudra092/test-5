const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors({ origin: '*' }));
app.use(express.json());

let onlineUsers = {}; // { userId: socket.id }

io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);

  socket.on('user-connected', (userId) => {
    onlineUsers[userId] = socket.id;
    console.log(`✅ User connected: ${userId}`);
    io.emit('online-users', Object.keys(onlineUsers)); // Broadcast updated list
  });

  socket.on('disconnect', () => {
    const disconnectedUserId = Object.keys(onlineUsers).find(uid => onlineUsers[uid] === socket.id);
    if (disconnectedUserId) {
      delete onlineUsers[disconnectedUserId];
      console.log(`❌ User disconnected: ${disconnectedUserId}`);
    }
    io.emit('online-users', Object.keys(onlineUsers)); // Broadcast updated list
  });

socket.on('chat-message', async (msg) => {
  const newMsg = new Message({
    from: msg.from,
    to: msg.to,
    text: msg.text
  });
  await newMsg.save();

  io.emit('chat-message', {
    ...msg,
    timestamp: newMsg.timestamp,
    seen: false
  });
});

// Mark message as seen
socket.on('mark-seen', async ({ from, to }) => {
  await Message.updateMany({ from, to, seen: false }, { seen: true });

  // Notify sender in real-time
  const senderSocketId = onlineUsers[from];
  if (senderSocketId) {
    io.to(senderSocketId).emit('seen-update', { from: to, to: from });
  }
});

});

// 🔗 MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// 👤 User Schema
const User = mongoose.model('User', new mongoose.Schema({
  username: String,
  password: String,
  email: String,
  fullname: String,
  phone: String,
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

// ➕ Friend Request Schema
const FriendRequest = mongoose.model('FriendRequest', new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, default: 'pending' } // pending, accepted
}));

// 📩 Message Schema
const messageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String,
  timestamp: { type: Date, default: Date.now },
  seen: { type: Boolean, default: false }
});
const Message = mongoose.model('Message', messageSchema);

// 📧 OTP Store
const otps = {};

// 📬 Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 📝 Register
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
    } else {
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
  const user = await User.findOneAndUpdate({ email }, { password });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  delete otps[email];
  res.json({ success: true, message: 'Password reset successfully' });
});

// 👤 Get current user + friends
app.get('/me/:id', async (req, res) => {
  const user = await User.findById(req.params.id).populate('friends', 'fullname username');
  if (!user) return res.status(404).json({ success: false });
  res.json({ success: true, user });
});

// 🛠️ Update Profile
app.put('/update-profile/:id', async (req, res) => {
  const { fullname, email, phone } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { fullname, email, phone }, { new: true });
  if (!user) return res.status(404).json({ success: false });
  res.json({ success: true, message: 'Profile updated!', user });
});

// 👥 All users with friends field
app.get('/users', async (req, res) => {
  const users = await User.find({}, 'username fullname friends');
  res.json(users);
});

// ➕ Send Friend Request (prevent duplicates)
app.post('/friend-request', async (req, res) => {
  const { from, to } = req.body;
  const exists = await FriendRequest.findOne({
    $or: [
      { from, to },
      { from: to, to: from }
    ],
    status: 'pending'
  });
  if (exists) return res.status(400).json({ success: false, message: 'Already requested' });

  await new FriendRequest({ from, to }).save();
  res.json({ success: true });
});

// 📩 Incoming friend requests
app.get('/friend-requests/:id', async (req, res) => {
  const requests = await FriendRequest.find({ to: req.params.id, status: 'pending' }).populate('from', 'fullname username');
  res.json(requests);
});

// 📤 Outgoing friend requests (to show "Request Sent")
app.get('/friend-requests/sent/:id', async (req, res) => {
  const requests = await FriendRequest.find({ from: req.params.id, status: 'pending' }).populate('to', 'fullname username');
  res.json(requests);
});

// 📜 Get chat history between two users
app.get('/chat-history/:userId1/:userId2', async (req, res) => {
  const { userId1, userId2 } = req.params;

  const messages = await Message.find({
    $or: [
      { from: userId1, to: userId2 },
      { from: userId2, to: userId1 }
    ]
  }).sort('timestamp');

  res.json({ success: true, messages });
});

// ✅ Accept Friend Request
app.post('/friend-request/accept', async (req, res) => {
  const { requestId } = req.body;
  const request = await FriendRequest.findById(requestId);
  if (!request) return res.status(404).json({ success: false });

  request.status = 'accepted';
  await request.save();

  const fromUser = await User.findById(request.from);
  const toUser = await User.findById(request.to);

  if (!fromUser.friends.includes(toUser._id)) fromUser.friends.push(toUser._id);
  if (!toUser.friends.includes(fromUser._id)) toUser.friends.push(fromUser._id);

  await fromUser.save();
  await toUser.save();

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
