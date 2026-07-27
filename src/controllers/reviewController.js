const App = require("../models/App");
const Review = require("../models/Review");

function toReviewJSON(review) {
  const user = review.user;
  return {
    id: review._id,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    user: user
      ? {
          id: user._id,
          name: user.name,
          username: user.username,
          photo: user.photo,
        }
      : null,
  };
}

/** GET /api/apps/:id/reviews — every review for an app, newest first. */
async function listReviews(req, res) {
  const app = await App.findById(req.params.id);
  if (!app) return res.status(404).json({ message: "App not found" });

  const reviews = await Review.find({ app: req.params.id })
    .sort({ createdAt: -1 })
    .populate("user");
  res.json(reviews.map(toReviewJSON));
}

/**
 * POST /api/apps/:id/reviews — leave (or edit) your review for an app.
 * Body: { rating: 1-5, comment: string }.
 * One review per user per app — submitting again just updates the
 * existing one, same as editing a review on the Play Store.
 */
async function upsertReview(req, res) {
  try {
    const { rating, comment } = req.body;
    const ratingNum = Number(rating);

    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "rating must be a number from 1 to 5" });
    }
    if (!comment || !comment.trim()) {
      return res.status(400).json({ message: "comment is required" });
    }

    const app = await App.findById(req.params.id);
    if (!app) return res.status(404).json({ message: "App not found" });

    const review = await Review.findOneAndUpdate(
      { app: req.params.id, user: req.user._id },
      { rating: ratingNum, comment: comment.trim() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate("user");

    res.status(201).json(toReviewJSON(review));
  } catch (err) {
    console.error("upsertReview error:", err.message);
    res.status(500).json({ message: err.message || "Failed to save review" });
  }
}

/** DELETE /api/apps/:id/reviews — remove your own review for an app. */
async function deleteReview(req, res) {
  const review = await Review.findOneAndDelete({
    app: req.params.id,
    user: req.user._id,
  });
  if (!review) return res.status(404).json({ message: "You haven't reviewed this app" });
  res.json({ message: "Review deleted" });
}

module.exports = { listReviews, upsertReview, deleteReview };
