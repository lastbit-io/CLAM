var express = require("express");
var router = express.Router();
const passport = require("passport");
var userController = require("../controller/userController");
var feedbackController = require("../controller/feedbackController");
var nodeController = require("../controller/nodeController");

//user
router.post("/login", userController.login);
router.post("/signup", userController.signup);

//feedback
router.post(
  "/feedback",
  passport.authenticate("jwt", { session: false }),
  feedbackController.saveFeedback
);

//details
router.post(
  "/gethid",
  passport.authenticate("jwt", { session: false }),
  userController.getHid
);
router.post(
  "/sethid",
  passport.authenticate("jwt", { session: false }),
  userController.setHid
);

router.post(
  "/getdepositaddress",
  passport.authenticate("jwt", { session: false }),
  userController.getDepositAddress
);
router.post(
  "/gettxs",
  passport.authenticate("jwt", { session: false }),
  userController.getTxs
);
router.post(
  "/getpending",
  passport.authenticate("jwt", { session: false }),
  userController.getPending
);
router.post(
  "/getbalance",
  passport.authenticate("jwt", { session: false }),
  userController.getBalance
);
router.get("/ping", async function (req, res) {
  res.status(200).send("pong");
});

// Invoice and payments

router.post(
  "/getinfo",
  nodeController.getInfo
);
router.post(
  "/payinvoiceless",
  passport.authenticate("jwt", { session: false }),
  nodeController.payInvoiceLess
);
router.post(
  "/getuserinvoices",
  passport.authenticate("jwt", { session: false }),
  nodeController.getUserInvoices
);
router.post(
  "/payinvoice",
  passport.authenticate("jwt", { session: false }),
  nodeController.payInvoice
);
router.post(
  "/decodepay",
  passport.authenticate("jwt", { session: false }),
  nodeController.decodePay
);

router.post(
  "/getnearbyinvoices",
  passport.authenticate("jwt", { session: false }),
  nodeController.getNearByInvoices
);
router.post(
  "/checkroute",
  passport.authenticate("jwt", { session: false }),
  nodeController.checkRoute
);
router.post(
  "/addinvoice",
  passport.authenticate("jwt", { session: false }),
  nodeController.addInvoice
);

router.post(
  "/withdraw",
  passport.authenticate("jwt", { session: false }),
  nodeController.withdraw
);

module.exports = router;
