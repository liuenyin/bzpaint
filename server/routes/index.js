const express = require("express");
// eslint-disable-next-line new-cap
const router = express.Router();
const canvasController = require("../controllers/canvas_controller");
const userController = require("../controllers/user_controller");

router.get("/", (req, res, next) => {
  res.json({ message: "Hello world" });
});

router.get("/canvas", canvasController.pixels_data);
router.get("/user", userController.user_data);
router.post("/invite", userController.generate_invite_code);
router.post("/delegate", userController.set_delegate);

module.exports = router;
