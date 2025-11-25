const express = require("express");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// ------------------------- CORS -------------------------
const clientUrls = [
    "http://localhost:5173",
    "https://feelancehub.netlify.app"
];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (clientUrls.indexOf(origin) !== -1) return callback(null, true);
        return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// ------------------------- MongoDB Setup -------------------------
const uri = process.env.DB_URI;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db;
let jobCollection;
let acceptedTasksCollection;

async function run() {
    try {
        console.log("Trying to connect with MongoDB...");
        
        try {
            await client.connect();
            console.log("✅ MongoDB connected successfully!");
        } catch (err) {
            console.error("❌ MongoDB connection failed:", err.message);
        }

        db = client.db(process.env.DB_NAME);
        jobCollection = db.collection("jobs");
        acceptedTasksCollection = db.collection("acceptedTasks");

        // ---------------- JWT Middleware ----------------
        const verifyToken = (req, res, next) => {
            const token = req.cookies.token;
            if (!token) return res.status(401).send({ message: "Unauthorized: No token" });

            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) return res.status(401).send({ message: "Unauthorized: Invalid token" });
                req.user = decoded;
                next();
            });
        };

        // ---------------- Routes ----------------
        app.get("/", (req, res) => {
            res.send("Freelance Hub Server is running!");
        });

        app.post("/jwt", async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });

            res.cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "None" : "Strict",
                maxAge: 60 * 60 * 1000
            }).send({ success: true });
        });

        app.post("/logout", async (req, res) => {
            res.clearCookie("token", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "None" : "Strict"
            }).send({ success: true });
        });

        // ---------------- Jobs ----------------
        app.get("/jobs", async (req, res) => {
            const { sort } = req.query;
            let sortQuery = { postingDate: -1 };
            if (sort === "asc") sortQuery = { postingDate: 1 };

            const result = await jobCollection.find().sort(sortQuery).toArray();
            res.send(result);
        });

        app.get("/job/:id", verifyToken, async (req, res) => {
            const job = await jobCollection.findOne({ _id: new ObjectId(req.params.id) });
            if (!job) return res.status(404).send({ message: "Job not found" });
            res.send(job);
        });

        app.get("/jobs/employer/:email", verifyToken, async (req, res) => {
            const employerEmail = req.params.email;
            if (req.user.email !== employerEmail) return res.status(403).send({ message: "Forbidden" });
            res.send(await jobCollection.find({ employerEmail }).toArray());
        });

        app.post("/jobs", verifyToken, async (req, res) => {
            const newJob = req.body;

            newJob.postingDate = new Date().toISOString();

            if (req.user.email !== newJob.employerEmail)
                return res.status(403).send({ message: "Forbidden: Email mismatch" });

            const result = await jobCollection.insertOne(newJob);
            res.send(result);
        });

        app.put("/job/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            const job = await jobCollection.findOne({ _id: new ObjectId(id) });
            if (!job || req.user.email !== job.employerEmail)
                return res.status(403).send({ message: "Forbidden" });

            const result = await jobCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedData }
            );

            res.send(result);
        });

        app.delete("/job/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const job = await jobCollection.findOne({ _id: new ObjectId(id) });

            if (!job || req.user.email !== job.employerEmail)
                return res.status(403).send({ message: "Forbidden" });

            res.send(await jobCollection.deleteOne({ _id: new ObjectId(id) }));
        });

        // ---------------- Accepted Tasks ----------------
        app.post("/accepted-tasks", verifyToken, async (req, res) => {
            const task = req.body;

            if (req.user.email !== task.jobTakerEmail)
                return res.status(403).send({ message: "Forbidden" });

            const exists = await acceptedTasksCollection.findOne({
                jobId: task.jobId,
                jobTakerEmail: task.jobTakerEmail
            });

            if (exists) return res.send({ message: "Already accepted", insertedId: null });

            res.send(await acceptedTasksCollection.insertOne(task));
        });

        app.get("/accepted-tasks/taker/:email", verifyToken, async (req, res) => {
            if (req.user.email !== req.params.email)
                return res.status(403).send({ message: "Forbidden" });

            res.send(await acceptedTasksCollection.find({ jobTakerEmail: req.params.email }).toArray());
        });

        app.delete("/accepted-tasks/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const task = await acceptedTasksCollection.findOne({ _id: new ObjectId(id) });

            if (!task || req.user.email !== task.jobTakerEmail)
                return res.status(403).send({ message: "Forbidden" });

            res.send(await acceptedTasksCollection.deleteOne({ _id: new ObjectId(id) }));
        });

        // ---------------- Error Handler ----------------
        app.use((err, req, res, next) => {
            console.error(err.stack);
            res.status(500).send("Something broke!");
        });
    } finally {}
}

run().catch(console.dir);

// ---------------- Serve Frontend ----------------
app.use(express.static(path.join(__dirname, "client", "dist")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

// ---------------- Start Server ----------------
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
