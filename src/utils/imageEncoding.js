/**
 * Turns a multer memory-storage file (req.file, with a .buffer and
 * .mimetype) into a self-contained base64 data URI, e.g.
 * "data:image/jpeg;base64,/9j/4AAQSkZJRg...".
 *
 * Storing this directly on the document means profile photos survive
 * fine on hosts with an ephemeral filesystem (like Render) — there's no
 * separate file to lose between deploys/restarts.
 */
function fileToDataUri(file) {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}

module.exports = { fileToDataUri };
