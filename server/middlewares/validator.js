require("dotenv").config();
const { body, validationResult } = require("express-validator");
const supabase = require("../db");

// Removing uniqueEmailChain as Supabase Auth handles it.
// We can catch the error in the controller.

const emailChain = () =>
  body("email").trim().escape();

const usernameChain = () =>
  body("name")
    .trim()
    .isLength({ min: 2, max: 20 })
    .escape()
    .withMessage("Name must have 2-20 characters.");

const remarkChain = () =>
  body("remark")
    .trim()
    .isLength({ min: 2, max: 50 })
    .escape()
    .withMessage("Remark (Class/Name) is required.");

const inviteCodeChain = () =>
  body("inviteCode")
    .trim()
    .escape()
    .custom(async (value) => {
      // Check if code exists and is unused
      // Note: We need Service Key to read all codes if RLS is strict, 
      // but "public read" policy on invite_codes might allow checking.
      // Better to use backend service client which we have in db.js

      const { data, error } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('code', value)
        .single();

      if (error || !data) {
        throw new Error("Invalid invitation code");
      }
      if (data.is_used) {
        throw new Error("Invitation code already used");
      }
      return true;
    });

const passwordChain = () =>
  body("password")
    .trim()
    .isLength({ min: 6 })
    .escape()
    .withMessage("Password must have at least 6 characters.");

const confirmPasswordChain = () =>
  body("confirmPassword")
    .trim()
    .escape()
    .custom((value, { req }) => {
      return value === req.body.password;
    })
    .withMessage("Passwords do not match");

// We keep userTypeChain/secretChain if we want to support direct admin creation
// But for School version, maybe just Basic users via Invite.
// Let's keep it for compatibility but simplify.

const validateChains = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }

  return res.status(400).json({
    error: errors.array().map((e) => e.msg).join(", "),
  });
};

module.exports = {
  emailChain,
  usernameChain,
  remarkChain,
  inviteCodeChain,
  passwordChain, // Exported for consistent usage
  confirmPasswordChain,
  validateChains,
};
