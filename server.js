const express = require("express");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- Middleware ---
app.use(cors({
    origin: ['http://localhost:5173'],
    credentials: true,
}));
app.use(express.json());
app.use(bodyParser.json());
app.use(cookieParser());

// --- MongoDB Setup ---
const uri = process.env.DB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    tls: true,
    tlsAllowInvalidCertificates: true,
});

let db;
let jobCollection;
let acceptedTasksCollection;

async function run() {
    try {
        await client.connect();
        db = client.db(process.env.DB_NAME);
        jobCollection = db.collection("jobs");
        acceptedTasksCollection = db.collection("acceptedTasks");
        console.log("MongoDB connected!");

        // --- JWT Middleware ---
        const verifyToken = (req, res, next) => {
            const token = req.cookies.token;
            if (!token) return res.status(401).send({ message: 'Unauthorized: No token' });
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) return res.status(401).send({ message: 'Unauthorized: Invalid token' });
                req.user = decoded;
                next();
            });
        };

        // --- API Routes ---
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Strict',
                maxAge: 60 * 60 * 1000
            }).send({ success: true, message: "Token set successfully" });
        });

        app.post('/logout', async (req, res) => {
            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Strict',
            }).send({ success: true, message: "Logged out" });
        });

        app.get('/jobs', async (req, res) => {
            const { sort } = req.query;
            let sortQuery = { postingDate: -1 };
            if (sort === 'asc') sortQuery = { postingDate: 1 };
            const result = await jobCollection.find().sort(sortQuery).toArray();
            res.send(result);
        });

        app.get('/job/:id', verifyToken, async (req, res) => {
            const job = await jobCollection.findOne({ _id: new ObjectId(req.params.id) });
            if (!job) return res.status(404).send({ message: "Job not found" });
            res.send(job);
        });

        // --- Other API routes similar to your previous code ---
        // Add /jobs/employer/:email, POST /jobs, PUT /job/:id, DELETE /job/:id, acceptedTasks endpoints etc.

    } finally {
        // Optional: leave client open for live server
    }
}
run().catch(console.dir);

// --- Serve Frontend Build ---
app.use(express.static(path.join(__dirname, "client", "dist")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
