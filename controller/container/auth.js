const passport = require("passport");
const localStrategy = require("passport-local").Strategy;
const User = require("../../models/user");
const { JWT_ISSUER, JWT_AUDIENCE } = require("../../utils/config").JWT;
const Token = require("../../models/token");
const shortid = require("shortid");

//Create a passport middleware to handle user registration
passport.use(
  "signup",
  new localStrategy(
    {
      usernameField: "username",
      passwordField: "password",
      passReqToCallback: true,
    },
    async (req, username, password, done) => {
      try {
        //TODO: Ensure that username and password are signed by lastbit
        //Naive check
        if (username.length < 2 && password.length < 2)
          return done("Invalid user");
        else {
          //Save the information provided by the user to the the database
          let hid = shortid.generate();
          var firebaseTokens = req.body.firebaseTokens;
          const user = await User.create({
            username,
            password,
            hid,
            firebaseTokens,
          });
          //Send the user information to the next middleware
          return done(null, user);
        }
      } catch (error) {
        done(error);
      }
    }
  )
);

//Create a passport middleware to handle User login
passport.use(
  "login",
  new localStrategy(
    {
      usernameField: "username",
      passwordField: "password",
    },
    async (username, password, done) => {
      try {
        const user = await User.findOne({ username });
        if (!user) {
          //If the user isn't found in the database, return a message
          return done(null, false, { message: "User not found" });
        }
        //Validate password and make sure it matches with the corresponding hash stored in the database
        //If the passwords match, it returns a value of true.
        const validate = await user.isValidPassword(password);
        if (!validate) {
          return done(null, false, { message: "Wrong password" });
        }
        //Send the user information to the next middleware
        return done(null, user, { message: "Logged in Successfully" });
      } catch (error) {
        return done(error);
      }
    }
  )
);

const JWTstrategy = require("passport-jwt").Strategy;
//We use this to extract the JWT sent by the user
const ExtractJWT = require("passport-jwt").ExtractJwt;

var opts = {};
opts.jwtFromRequest = ExtractJWT.fromBodyField("token");
opts.secretOrKeyProvider = secretOrKeyProvider;
opts.issuer = JWT_ISSUER;
opts.audience = JWT_AUDIENCE;

async function secretOrKeyProvider(request, rawJwtToken, done) {
  var db_token = await Token.findOne({ jwt: rawJwtToken });
  if (db_token) {
    var secret = await User.findOne({ _id: db_token.owner });
    done(null, secret.password);
  } else {
    done("Unauthorized");
  }
}

//This verifies that the token sent by the user is valid
passport.use(
  new JWTstrategy(opts, async (token, done) => {
    try {
      //Pass the user details to the next middleware
      return done(null, token.user);
    } catch (error) {
      done(error);
    }
  })
);
