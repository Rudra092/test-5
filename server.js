// server.js
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(cors());
app.use(express.json());

// MongoDB setup (schemas omitted for brevity, same as before)

let userSockets = {}; // map userId -> socket

io.on('connection', socket => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('user-connected', ({ id, fullname }) => {
    socket.userId = id;
    socket.fullname = fullname;
    userSockets[id] = socket;
    io.emit('update-status', { userId: id, status: true });
  });

  socket.on('typing', ({ from, to }) => {
    const destSocket = userSockets[to];
    if (destSocket) destSocket.emit('typing', { from });
  });

  socket.on('chat-message', async msg => {
    try {
      const newMsg = new Message({
        from: msg.from,
        to: msg.to,
        content: msg.text || msg.image || '',
        type: msg.image ? 'image' : 'text',
        timestamp: new Date(),
        seen: false
      });
      await newMsg.save();

      const payload = {
        _id: newMsg._id,
        from: msg.from,
        to: msg.to,
        text: msg.text,
        image: msg.image,
        timestamp: newMsg.timestamp,
        seen: false
      };

      socket.emit('chat-message', payload);
      if (userSockets[msg.to]) userSockets[msg.to].emit('chat-message', payload);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  socket.on('mark-seen', async ({ from, to }) => {
    await Message.updateMany({ from, to, seen: false }, { seen: true });
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      delete userSockets[socket.userId];
      io.emit('update-status', { userId: socket.userId, status: false });
      console.log(`❌ User disconnected: ${socket.userId}`);
    }
  });
});

// REST API endpoints
const otps = {};
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

app.post('/register', async (req, res) => {
  const { username, email, password, fullname, phone } = req.body;
  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) return res.status(400).json({ success: false, message: 'User already exists' });

  const user = new User({ username, email, password, fullname, phone });
  await user.save();
  res.json({ success: true, message: 'Registered successfully!' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const found = await User.findOne({ username, password });
  if (found) res.json({ success: true, message: 'Login successful!', user: found });
  else res.status(401).json({ success: false, message: 'Invalid credentials' });
});

app.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps[email] = otp;
  await transporter.sendMail({
    from: `App <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'OTP Code',
    html: `<p>Your OTP is: <strong>${otp}</strong></p>`
  });
  res.json({ success: true, message: 'OTP sent' });
});

app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (otps[email] === otp) {
    delete otps[email];
    return res.json({ success: true });
  }
  res.json({ success: false });
});

app.post('/reset-password', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOneAndUpdate({ email }, { password });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  delete otps[email];
  res.json({ success: true });
});

app.get('/me/:id', async (req, res) => {
  const user = await User.findById(req.params.id).populate('friends', 'fullname username avatar');
  if (!user) return res.status(404).json({ success: false });
  res.json({ success: true, user });
});

app.put('/update-profile/:id', async (req, res) => {
  const { fullname, email, phone } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { fullname, email, phone }, { new: true });
  res.json({ success: true, user });
});

app.get('/users', async (req, res) => {
  const users = await User.find({}, 'username fullname avatar friends');
  res.json(users);
});

app.post('/upload-avatar/:id', upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
  const user = await User.findByIdAndUpdate(req.params.id, { avatar: `/uploads/${req.file.filename}` }, { new: true });
  res.json({ success: true, user });
});

app.post('/friend-request', async (req, res) => {
  const { from, to } = req.body;
  const exists = await FriendRequest.findOne({ from, to, status: 'pending' });
  if (exists) return res.status(400).json({ success: false });
  await new FriendRequest({ from, to }).save();
  res.json({ success: true });
});

app.get('/friend-requests/:id', async (req, res) => {
  const requests = await FriendRequest.find({ to: req.params.id, status: 'pending' }).populate('from', 'fullname username avatar');
  res.json(requests);
});

app.post('/friend-request/accept', async (req, res) => {
  const { requestId } = req.body;
  const request = await FriendRequest.findById(requestId);
  if (!request) return res.status(404).json({ success: false });
  request.status = 'accepted';
  await request.save();
  const fromUser = await User.findById(request.from);
  const toUser = await User.findById(request.to);
  if (!fromUser.friends.map(f => f.toString()).includes(toUser._id.toString())) fromUser.friends.push(toUser._id);
  if (!toUser.friends.map(f => f.toString()).includes(fromUser._id.toString())) toUser.friends.push(fromUser._id);
  await fromUser.save();
  await toUser.save();
  res.json({ success: true });
});

app.get('/messages/:userId/:friendId', async (req, res) => {
  const { userId, friendId } = req.params;
  const messages = await Message.find({
    $or: [
      { from: userId, to: friendId },
      { from: friendId, to: userId }
    ]
  }).sort({ timestamp: 1 });
  res.json(messages);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
