const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/softstore";

  try {
    await mongoose.connect(uri);
    console.log(`MongoDB connected -> ${uri}`);
    console.log(
      "Tip: point MongoDB Compass at the same URI to browse the 'softstore' database."
    );
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    console.error(
      "Make sure a local MongoDB server is running (e.g. `mongod` or the MongoDB Compass connection target)."
    );
    process.exit(1);
  }
}

module.exports = connectDB;
