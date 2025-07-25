const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

mongoose.connect("mongodb+srv://<your_mongo_url>", {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

// ==== MODELS ====
const User = mongoose.model("User", new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  fullname: String,
  phone: String,
  photo: String,
}));

const FriendRequest = mongoose.model("FriendRequest", new mongoose.Schema({
  from: mongoose.Schema.Types.ObjectId,
  to: mongoose.Schema.Types.ObjectId,
}));

const Message = mongoose.model("Message", new mongoose.Schema({
  from: mongoose.Schema.Types.ObjectId,
  to: mongoose.Schema.Types.ObjectId,
  text: String,
  timestamp: { type: Date, default: Date.now }
}));

// ==== MULTER FOR PHOTO UPLOAD ====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ==== AUTH ROUTES ====
app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.json({ success: false, message: "Email already registered" });

  const user = await User.create({ username, email, password });
  res.json({ success: true, user });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email, password });
  if (!user) return res.json({ success: false, message: "Invalid credentials" });

  res.json({ success: true, user });
});

// ==== PROFILE ====
app.put("/update-profile/:id", async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, user });
});

app.post("/upload-photo/:id", upload.single("photo"), async (req, res) => {
  const photoPath = `https://test-5-jdfo.onrender.com/uploads/${req.file.filename}`;
  await User.findByIdAndUpdate(req.params.id, { photo: photoPath });
  res.json({ success: true, url: photoPath });
});

// ==== FRIEND REQUESTS ====
app.post("/send-request", async (req, res) => {
  const { from, to } = req.body;
  const exists = await FriendRequest.findOne({ from, to });
  if (exists) return res.json({ message: "Already sent" });

  await FriendRequest.create({ from, to });
  res.json({ message: "Friend request sent" });
});

app.post("/accept-request", async (req, res) => {
  const { from, to } = req.body;
  await FriendRequest.deleteOne({ from, to });
  await FriendRequest.deleteOne({ from: to, to: from });
  await FriendRequest.create({ from, to }); // accepted friend (bidirectional simulated)
  await FriendRequest.create({ from: to, to: from });
  res.json({ message: "Friend request accepted" });
});

app.get("/incoming-requests/:id", async (req, res) => {
  const requests = await FriendRequest.find({ to: req.params.id });
  const users = await User.find({ _id: { $in: requests.map(r => r.from) } });
  res.json(users);
});

app.get("/friends/:id", async (req, res) => {
  const sent = await FriendRequest.find({ from: req.params.id });
  const received = await FriendRequest.find({ to: req.params.id });
  const friendIds = sent
    .filter(s => received.some(r => String(r.from) === String(s.to)))
    .map(s => s.to);
  const friends = await User.find({ _id: { $in: friendIds } });
  res.json(friends);
});

// ==== SUGGESTIONS ====
app.get("/suggestions/:id", async (req, res) => {
  const allUsers = await User.find({ _id: { $ne: req.params.id } });
  const requests = await FriendRequest.find({
    $or: [{ from: req.params.id }, { to: req.params.id }]
  });

  const connectedIds = new Set(
    requests.map(r => String(r.from) === req.params.id ? r.to : r.from)
  );

  const suggestions = allUsers.filter(u => !connectedIds.has(String(u._id)));
  res.json(suggestions);
});

// ==== SEARCH USERS ====
app.get("/search-users", async (req, res) => {
  const users = await User.find({
    username: { $regex: req.query.query, $options: "i" }
  }).select("_id username");
  res.json(users);
});

// ==== MESSAGING ====
app.post("/message", async (req, res) => {
  const { from, to, text } = req.body;
  await Message.create({ from, to, text });
  res.json({ success: true });
});

app.get("/messages/:from/:to", async (req, res) => {
  const { from, to } = req.params;
  const messages = await Message.find({
    $or: [
      { from, to },
      { from: to, to: from }
    ]
  }).sort("timestamp");
  res.json(messages);
});

// ==== SERVER START ====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
