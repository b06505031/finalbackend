import mongoose from "mongoose";
import http from "http";
import WebSocket from "ws";
import express from "express";
import path from "path";
import { v4 } from "uuid";
import dotenv from "dotenv-defaults";
import mongo from "./mongo";

const app = express();
dotenv.config();

/* -------------------------------------------------------------------------- */
/*                               MONGOOSE MODELS                              */
/* -------------------------------------------------------------------------- */
const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String },
  password: { type: String },
  dateBoxes: [{ type: mongoose.Types.ObjectId, ref: "DateBox" }],
});

const dataSchema = new Schema({
  dateBox: { type: mongoose.Types.ObjectId, ref: "DateBox" },
  user: { type: mongoose.Types.ObjectId, ref: "User" },
  item: { type: String, required: true },
  category: { type: String, required: true },
  dollar: { type: String, required: true },
});

const dateBoxSchema = new Schema({
  name: { type: String, required: true },
  user: [{ type: mongoose.Types.ObjectId, ref: "User" }],
  datas: [{ type: mongoose.Types.ObjectId, ref: "Data" }],
});

const UserModel = mongoose.model("User", userSchema);
const DateBoxModel = mongoose.model("DateBox", dateBoxSchema);
const DataModel = mongoose.model("Data", dataSchema);

/* -------------------------------------------------------------------------- */
/*                                  UTILITIES                                 */
/* -------------------------------------------------------------------------- */
const makeName = (name, date) => {
  return [name, date].sort().join("_");
};

/* -------------------------------------------------------------------------- */
/*                            SERVER INITIALIZATION                           */
/* -------------------------------------------------------------------------- */
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
});

// app.use(express.static(path.join(__dirname, 'public')));

const validateUser = async (name) => {
  const existing = await UserModel.findOne({ name });
  if (existing) return existing;
  // return new UserModel({ name,password }).save();
};

const validateDateBox = async (name, user) => {
  let box = await DateBoxModel.findOne({ name });
  if (!box) box = await new DateBoxModel({ name, user }).save();
  return box.populate("user").populate({ path: "datas", populate: "user" }).execPopulate();
};

const chatBoxes = {};
const dateBoxes = {};
wss.on("connection", function connection(client) {
  client.id = v4();
  client.box = "";

  client.sendEvent = (e) => client.send(JSON.stringify(e));

  client.on("message", async function incoming(message) {
    message = JSON.parse(message);
    // console.log(message);
    const { type } = message;

    switch (type) {
      case "OPEN": {
        const {
          data: { name, date },
        } = message;

        const dateBoxName = makeName(name, date);
        const user = await UserModel.findOne({ name });
        const dateBox = await validateDateBox(dateBoxName, user);
        if (dateBoxes[client.box]) {
          dateBoxes[client.box].delete(client);
        }
        client.box = dateBoxName;
        if (!dateBoxes[dateBoxName]) dateBoxes[dateBoxName] = new Set(); // make new record for chatbox
        dateBoxes[dateBoxName].add(client);
        // console.log(dateBox.length)

        // console.log("----------------------------------------------------")
        client.sendEvent({
          type: "OPEN",
          data: {
            datas: dateBox.datas.map(({ user: { name }, item, category, dollar, _id }) => ({
              // name,
              // DataModel.findById
              item,
              category,
              dollar,
              key: _id,
              // dateBoxName,
            })),
          },
        });

        break;
      }
      case "UPLOAD": {
        const {
          data: { name, date, item, category, dollar },
        } = message;
        const dateBoxName = makeName(name, date);

        const user = await UserModel.findOne({ name });
        const dateBox = await validateDateBox(dateBoxName, user);
        const newItem = new DataModel({ user, item: item, category: category, dollar: dollar });
        await newItem.save();
        dateBox.datas.push(newItem);
        await dateBox.save();
        console.log(item);
        dateBoxes[dateBoxName].forEach((client) => {
          // console.log(client);
          client.sendEvent({
            type: "UPLOAD",
            data: {
              data: {
                name,
                item,
                category,
                dollar,
                dateBoxName,
              },
            },
          });
        });
        break;
      }
      case "PASSCHANGE": {
        const {
          data: { name, password },
        } = message;
        const existuser = await UserModel.findOneAndUpdate({ name: name }, { password: password });
        await existuser.save();
        client.sendEvent({
          type: "PASSCHANGE",
          data: {
            change: true,
          },
        });
        break;
      }
      case "DELETE": {
        const {
          data: { id },
        } = message;
        const listItem = await DataModel.findByIdAndDelete(id);
        break;
      }
      case "CHECK": {
        const {
          data: { name, password },
        } = message;
        const existuser = await UserModel.findOne({ name });
        if (!existuser) {
          const user = new UserModel({ name: name, password: password });
          await user.save();
          client.sendEvent({
            type: "CHECK",
            data: {
              login: true,
            },
          });
        } else {
          if (existuser.password !== password) {
            // console.log("password ERROR")
            client.sendEvent({
              type: "CHECK",
              data: {
                login: false,
              },
            });
          } else if (existuser.password === password) {
            client.sendEvent({
              type: "CHECK",
              data: {
                login: true,
              },
            });
          }
        }
        break;
      }
    }

    // disconnected
    client.once("close", () => {
      dateBoxes[client.box].delete(client);
    });
  });
});

mongo.connect();
const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log("Server listening at http://localhost:4000");
});
