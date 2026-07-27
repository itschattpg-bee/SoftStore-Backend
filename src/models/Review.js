const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    app: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "App",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

// One review per user per app — resubmitting just edits it (see
// upsertReview in reviewController), same as how Play Store review
// editing works.
reviewSchema.index({ app: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Review", reviewSchema);
