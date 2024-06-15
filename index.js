const express = require('express');
const app = express();
require('dotenv').config()
const cors = require('cors');
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken')
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

const port = process.env.PORT || 5000;

// middleware 
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    optionSuccessStatus: 200,
  }
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser())

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
    const token = req.cookies?.token
    console.log(token)
    if (!token) {
      return res.status(401).send({ message: 'unauthorized access!!' })
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        console.log(err)
        return res.status(401).send({ message: 'unauthorized access' })
      }
      req.user = decoded
      console.log({decoded})
      next()
    })
  }
  


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ajfjwu7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
     const propertyCollection = client.db('b9-a12').collection('property')
     const usersCollection = client.db('b9-a12').collection('users')
     const offeredCollection = client.db('b9-a12').collection('offered')
     const ReviewCollection = client.db('b9-a12').collection('review')
     const bookingsCollection = client.db('b9-a12').collection('bookings')
     
      // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      console.log({user})
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    //logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // create payment intent
    app.post('/create-payment-intent', async (req, res) => {
      const price = req.body.price
      const priceInCent = parseFloat(price) * 100
      if (!price || priceInCent < 1) return
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      });
      // send client secret as response
      res.send({ clientSecret: client_secret })
    })

     //save booking data in db
     app.post('/booking', async (req, res) => {
      const bookingData = req.body
      // save room booking info
      const result = await bookingsCollection.insertOne(bookingData)
      res.send(result)
    })

      // update room availability status
      app.patch('/property/status/:id', async (req, res) => {
        const id = req.params.id
        const {transactionId} = req.body
        //change the room avilability status
        const query = { _id: new ObjectId(id) }
        const updateDoc = {
          $set: { 
            status: 'Bought',
            transactionId:transactionId
           },
        }
        const result = await offeredCollection.updateOne(query, updateDoc)
        res.send(result)
      })
    //save user data in database
    app.put('/user', async (req, res) => {
      const user = req.body
       const query = {name:user?.name, email: user?.email }
       console.log(query)
      //check if the user exist
      const isExist = await usersCollection.findOne(query)
      if (isExist) {
        return res.send(isExist)
        // if (user.status === 'Requested') {
        //   const result = await usersCollection.updateOne(query, {
        //     $set: { status: user?.status }
        //   })
        //   return res.send(result)
        // } else {
        //   return res.send(isExist)
        // }
      }
      // save user for the first time
      const options = { upsert: true }
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      }
      const result = await usersCollection.updateOne(query, updateDoc, options)
      res.send(result)
    })


    //get user info by email from db 
    app.get('/user/:email', async (req, res) => {
      const email = req.params.email
      const result = await usersCollection.findOne({ email })
      res.send(result)
    })
     //get all user data from database
     app.get('/users',  async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

    // make admin
    app.patch('/users/admin/:id', async(req, res)=>{
      const id = req.params.id;
      const filter = { _id : new ObjectId(id)}
      const updatedDoc = {
        $set : {
          role : 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })
    // make agent
    app.patch('/users/agent/:id', async(req, res)=>{
      const id = req.params.id;
      const filter = { _id : new ObjectId(id)}
      const updatedDoc = {
        $set : {
          role : 'agent'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })
    // make fraud
    app.patch('/users/fraud/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
    
      try {
        // Find the user by ID to get their email
        const user = await usersCollection.findOne(filter);
        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }
        // Delete all properties added by this user
        const deleteResult = await propertyCollection.deleteMany({ 'agent.email': user.email });
        console.log(`Deleted ${deleteResult.deletedCount} properties added by user ${user.email}`);
        // Update user role to fraud
        const updatedDoc = {
          $set: {
            role: 'fraud'
          }
        };
        const updateResult = await usersCollection.updateOne(filter, updatedDoc);
        if (updateResult.modifiedCount > 0) {
          res.send({ message: 'User role updated to fraud and properties deleted', modifiedCount: updateResult.modifiedCount });
        } else {
          res.status(500).send({ message: 'Failed to update user role' });
        }
      } catch (error) {
        console.error('Error updating user role and deleting properties:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });
    

     // delete users
     app.delete('/users/:id', async(req,res)=>{
      const id = req.params.id;
      const query = { _id: new ObjectId(id)}
      const result = await usersCollection.deleteOne(query)
      res.send(result)
    })

      //get all property from db
    app.get('/propertys', async (req, res) => {
        const result = await propertyCollection.find().toArray()
        res.send(result)
      })
       //save property data in db
    app.post('/property', async (req, res) => {
      const propertyData = req.body
      const result = await propertyCollection.insertOne(propertyData)
      res.send(result)
    })
    //get all property for agent
    app.get('/my-added/:email',  async (req, res) => {
      const email = req.params.email
      let query = { 'agent.email': email }
      const result = await propertyCollection.find(query).toArray()
      res.send(result)
    })
    //get all property for agent
    app.get('/manage-property',  async (req, res) => {
      // const email = req.params.email
      // let query = { 'agent.email': email }
      const result = await propertyCollection.find().toArray()
      res.send(result)
    })
    // verify
    app.patch('/propertys/status/:id', async(req, res)=>{
      const id = req.params.id;
      const filter = { _id : new ObjectId(id)}
      const updatedDoc = {
        $set : {
          status : 'verified'
        }
      }
      const result = await propertyCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })
    // add to wishlist
    app.patch('/property/status/:id', async(req, res)=>{
      const user = req.body
      const id = req.params.id;
      const filter = { _id : new ObjectId(id)}
      const updatedDoc = {
        $set : {...user, add: 'wishlist'}
      }
      const result = await propertyCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })
    //remove wishlist
    app.patch('/wishlist/remove/:id', async(req, res) => {
      const id = req.params.id;
      try {
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $unset: { add: "" }
        };
        const result = await propertyCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error('Error removing property from wishlist:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    // save the data in offered collection
    app.post('/offered/:id', async (req, res) => {
      const propertyData = req.body
      // const id = req.params.id;
      // const query = { _id: new ObjectId(id)}

      const propertyQuery = {
        location: propertyData.location,
        title: propertyData.title,
        price: propertyData.price,
        agent: propertyData.agent,
        guest: propertyData.guest
      };
      const isExist = await offeredCollection.findOne(propertyQuery)
      if (isExist) {
        return res.status(409).send({ message: 'This offer has already been submitted.' });
      }
      const result = await offeredCollection.insertOne(propertyData)
      res.send(result)
    })

    //get the data from data base 
    app.get('/offer', async (req, res) => {
      const result = await offeredCollection.find().toArray()
      res.send(result)
    })

    //review
    app.post('/review/:id', async (req, res) => {
      const reviewData = req.body
      const result = await ReviewCollection.insertOne(reviewData)
      res.send(result)
    })
    app.get('/reviews', async (req, res) => {
      const result = await ReviewCollection.find().toArray()
      res.send(result)
    })
    //get offer data
    app.get('/offers', async (req, res) => {
      const result = await offeredCollection.find().toArray()
      res.send(result)
    })
    //delete an offer
    app.delete('/offers/delete/:id', async(req,res)=>{
      const id = req.params.id;
      const query = { _id: new ObjectId(id)}
      const result = await offeredCollection.deleteOne(query)
      res.send(result)
    })
    // update status of an offer
    app.patch('/offer/status/:id', async(req, res)=>{
      const id = req.params.id;
      const filter = { _id : new ObjectId(id)}
      const updatedDoc = {
        $set : {
          status : 'Accepted'
        }
      }
      const result = await offeredCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })

    //delete review
    app.delete('/reviews/delete/:id', async(req,res)=>{
      const id = req.params.id;
      const query = { _id: new ObjectId(id)}
      const result = await ReviewCollection.deleteOne(query)
      res.send(result)
    })




    //reject
    app.delete('/manage-propertys/:id', async(req,res)=>{
      const id = req.params.id;
      const query = { _id: new ObjectId(id)}
      const result = await propertyCollection.deleteOne(query)
      res.send(result)
    })

    //delete a property data 
    app.delete('/property/:id',  async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await propertyCollection.deleteOne(query)
      res.send(result)
    })
    //update property data
    app.put('/property/update/:id',  async(req,res)=>{
      const id = req.params.id
      const propertyData = req.body
      const query = {_id: new ObjectId(id)}
      const updateDoc = {
        $set : propertyData,
      }
      const result = await propertyCollection.updateOne(query, updateDoc)
      res.send(result)
    })





      //get single property data using _id
    app.get('/property/:id', async (req, res) => {
      const id = req.params.id
      const result = await propertyCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })


   
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res)=>{
    res.send('real state')
})
app.listen(port,()=>{
    console.log(`Real state ${port}`);
})