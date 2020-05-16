const saveFeedback = (req, res) => {
  res.status(200).send("Feedback sent");
};

module.exports = {
  saveFeedback,
};
