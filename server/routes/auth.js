const express = require("express");
// eslint-disable-next-line new-cap
const router = express.Router();
const authController = require("../controllers/auth_controller");

router.post("/register", authController.create_new_user);

/* Authenticate users login */
router.post("/login", authController.authenticate_user);

/* Deal with user log out*/
router.post("/logout", authController.logout_user);

module.exports = router;
