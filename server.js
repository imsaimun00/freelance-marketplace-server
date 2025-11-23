const express = require("express");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- Middleware ---
const clientUrls = [
    'http://localhost:5173', 
    'https://feelancehub.netlify.app',
    'https://freelance-marketplace-server-n82ua9a9i.vercel.app' 
];

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin
        if (!origin) return callback(null, true);
        
        // Allow if the origin is in allowed list
        if (clientUrls.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            // Block all other origins
            callback(new Error('Not allowed by CORS'), false);
        }
    },
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
//app.use(bodyParser.json());
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

        
        app.get('/', (req, res) => {
            res.send('Freelance Hub Server is running!');
        });
        // ----------------------------------------------------

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

        app.get('/jobs/employer/:email', verifyToken, async (req, res) => {
            const employerEmail = req.params.email;
            
            if (req.user.email !== employerEmail) {
                return res.status(403).send({ message: 'Forbidden: Cannot access other user\'s jobs' });
            }

            const query = { employerEmail };
            const result = await jobCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/jobs', verifyToken, async (req, res) => {
            const newJob = req.body;
            newJob.postingDate = new Date(newJob.postingDate || new Date()).toISOString(); 
            
            if (req.user.email !== newJob.employerEmail) {
                return res.status(403).send({ message: 'Forbidden: Email mismatch' });
            }

            const result = await jobCollection.insertOne(newJob);
            res.send(result);
        });

        app.put('/job/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;
            
            const job = await jobCollection.findOne({ _id: new ObjectId(id) });

            if (!job || req.user.email !== job.employerEmail) {
                return res.status(403).send({ message: 'Forbidden: You cannot update this job' });
            }
            
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    jobTitle: updatedData.jobTitle,
                    jobCategory: updatedData.jobCategory,
                    description: updatedData.description,
                    coverImage: updatedData.coverImage,
                    minPrice: updatedData.minPrice,
                    maxPrice: updatedData.maxPrice,
                    deadline: updatedData.deadline,
                },
            };
            const result = await jobCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        app.delete('/job/:id', verifyToken, async (req, res) => {
            const id = req.params.id;

            const job = await jobCollection.findOne({ _id: new ObjectId(id) });
            
            if (!job || req.user.email !== job.employerEmail) {
                return res.status(403).send({ message: 'Forbidden: You cannot delete this job' });
            }

            const query = { _id: new ObjectId(id) };
            const result = await jobCollection.deleteOne(query);
            res.send(result);
        });

        // --- ACCEPTED TASKS Endpoints ---

        app.post('/accepted-tasks', verifyToken, async (req, res) => {
            const task = req.body;
            const jobTakerEmail = task.jobTakerEmail;

            if (req.user.email !== jobTakerEmail) {
                return res.status(403).send({ message: 'Forbidden: Email mismatch' });
            }
            
            const existingTask = await acceptedTasksCollection.findOne({ 
                jobId: task.jobId, 
                jobTakerEmail: jobTakerEmail 
            });

            if (existingTask) {
                return res.send({ message: 'Already accepted', insertedId: null });
            }

            const result = await acceptedTasksCollection.insertOne(task);
            res.send(result);
        });
        
        app.get('/accepted-tasks/taker/:email', verifyToken, async (req, res) => {
            const jobTakerEmail = req.params.email;
            
            if (req.user.email !== jobTakerEmail) {
                return res.status(403).send({ message: 'Forbidden: Cannot access other user\'s accepted tasks' });
            }

            const query = { jobTakerEmail };
            const result = await acceptedTasksCollection.find(query).toArray();
            res.send(result);
        });

        app.delete('/accepted-tasks/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            
            const task = await acceptedTasksCollection.findOne(query);
            if (!task || req.user.email !== task.jobTakerEmail) {
                return res.status(403).send({ message: 'Forbidden: You cannot perform this action on this task' });
            }

            const result = await acceptedTasksCollection.deleteOne(query);
            res.send(result);
        });

        // --- Default Route & Error Handling ---
        app.get('/', (req, res) => {
            res.send('Freelance Hub Server is running!');
        });
        
        // Error handling middleware
        app.use((err, req, res, next) => {
            console.error(err.stack);
            res.status(500).send('Something broke!');
        });

    } finally {}
}
run().catch(console.dir);

// Serve Frontend Build
app.use(express.static(path.join(__dirname, "client", "dist")));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});