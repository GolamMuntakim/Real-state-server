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
    console.log({ decoded })
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

     //verify admin middleware
     const verifyAdmin = async (req, res, next) => {
      const user = req.user
      const query = { email: user?.email }
      const result = await usersCollection.findOne(query)
      // console.log(result?.role)
      if (!result || result?.role !== 'admin')
        return res.status(401).send({ message: 'unauthorized access' })
      next()
    }
    //verify host middleware
    const verifyAgent = async (req, res, next) => {
      const user = req.user
      console.log("verify" , {user})
      const query = { email: user?.email }
      const result = await usersCollection.findOne(query)
      // console.log(result?.role)
      if (!result || result?.role !== 'agent')
        return res.status(401).send({ message: 'unauthorized access' })
      next()
    }

    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      console.log({ user })
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '7h',
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
    app.get('/admin-stat',verifyToken,verifyAdmin, async (req, res) => {
      const bookingDetails = await bookingsCollection.find({}, { projection: { title: 1, price: 1 } }).toArray()
      const totalusers = await usersCollection.countDocuments()
      const totalProperty = await propertyCollection.countDocuments()
      const totalReview = await ReviewCollection.countDocuments()
      const totalPrice = bookingDetails.reduce((sum, booking) => sum + booking.price, 0)
      const chartData = bookingDetails.map(booking => {

        const data = [booking?.title, booking?.price]
        return data
      })
      chartData.unshift(['title', 'price'])
      res.send({ bookingDetails, totalusers, totalProperty, totalReview, totalPrice, totalbookings: bookingDetails.length, chartData })
    })

    app.get('/agent-stat',verifyToken,verifyAgent, async (req, res) => {
      const bookingDetails = await bookingsCollection.countDocuments()
      const totalProperty = await propertyCollection.countDocuments()
      const totalRequestedProperty = await offeredCollection.find({}, { projection: { title: 1, status: 1, price: 1 } }).toArray()

      const totalSoldProperty = await offeredCollection.countDocuments({ status: "Bought" })
      const chartData = totalRequestedProperty.map(booking => {
        const data = [booking?.title, booking?.price]
        return data
      })
      chartData.unshift(['title', 'status', 'price'])
      res.send({ bookingDetails, totalRequestedProperty, totalProperty, totalSoldProperty, chartData })
    })
    app.get('/guest-stat',verifyToken, async (req, res) => {
      const bookingDetails = await bookingsCollection.find({}, { projection: { title: 1, status: 1, price: 1 } }).toArray()
      const totalProperty = await propertyCollection.countDocuments()
      const totalRequestedProperty = await offeredCollection.find({}, { projection: { title: 1, status: 1, price: 1 } }).toArray()
      const totalReview = await ReviewCollection.countDocuments()
      const totalSoldProperty = await offeredCollection.countDocuments({ status: "Bought" })
      const chartData = bookingDetails.map(booking => {
        const data = [booking?.title, booking?.status, booking?.price]
        return data
      })
      chartData.unshift(['title', 'status', 'price'])
      res.send({ bookingDetails, totalRequestedProperty, totalProperty, totalSoldProperty, chartData, totalReview })
    })


    // create payment intent
    app.post('/create-payment-intent',verifyToken, async (req, res) => {
      const price = req.body.price
      const priceInCent = parseFloat(price) * 100
      if (!price || priceInCent < 1) return
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });
      // send client secret as response
      res.send({ clientSecret: client_secret })
    })

    //save booking data in db
    app.post('/booking',verifyToken, async (req, res) => {
      const bookingData = req.body
      const result = await bookingsCollection.insertOne(bookingData)
      res.send(result)
    })

    // get all the sold propertys
    app.get('/sold',verifyToken,verifyAgent, async (req, res) => {
      const result = await bookingsCollection.find().toArray()
      res.send(result)
    })
    // get all the sold reviews
    app.get('/manage-reviews', async (req, res) => {
      const result = await ReviewCollection.find().toArray()
      res.send(result)
    })


    // delete reviews by admin
    app.delete('/deletereviews/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await ReviewCollection.deleteOne(query)
      res.send(result)
    })

    // update buying  status
    app.patch('/property/status/:id', async (req, res) => {
      const id = req.params.id
      const { transactionId } = req.body
      //change the room avilability status
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          status: 'Bought',
          transactionId: transactionId
        },
      }
      const result = await offeredCollection.updateOne(query, updateDoc)
      res.send(result)
    })
    //save user data in database
    app.put('/user', async (req, res) => {
      const user = req.body
      const query = { name: user?.name, email: user?.email }
      console.log(query)
      //check if the user exist
      const isExist = await usersCollection.findOne(query)
      if (isExist) {
        return res.send(isExist)
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
    app.get('/users',verifyToken,verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

    // make admin
    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })
    // make agent
    app.patch('/users/agent/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          role: 'agent'
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
    app.delete('/users/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await usersCollection.deleteOne(query)
      res.send(result)
    })

    //get all in advertisement from db
    app.get('/propertys', async (req, res) => {
      const result = await propertyCollection.find().toArray()
      res.send(result)
    })
    //get all advertise property
    app.get('/advertise', async (req, res) => {
      const result = await propertyCollection.find().toArray()
      res.send(result)
    })
    //add to advertisement section
    app.patch('/advertisement/:id', async (req, res) => {
      const user = req.body
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: { ...user, newAdd: 'advertise' }
      }
      const result = await propertyCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })
    // add wishlist
    app.patch('/wislist/status/:id',verifyToken, async (req, res) => {
      const user = req.body
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: { ...user, add: "wishlists" }
      };

      try {
        const result = await propertyCollection.updateOne(filter, updatedDoc);
        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: 'Property not found or update failed' });
        }
        res.send(result);
      } catch (error) {
        console.error('Error updating property status to wishlist:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    //get all in properties from db
    app.get('/all-properties', async (req, res) => {
      const search = req.query.search
      const sort = req.query.sort
      let query = {
        title: { $regex: search, $options: 'i' }
      }
      let options = {}
      if (sort) options = { sort: { price: sort === 'asc' ? 1 : -1 } }
      const result = await propertyCollection.find(query, options).toArray()
      res.send(result)
    })

    //save property data in db
    app.post('/property',verifyToken,verifyAgent, async (req, res) => {
      const propertyData = req.body
      const result = await propertyCollection.insertOne(propertyData)
      res.send(result)
    })
    //get all property for agent
    app.get('/my-added/:email',verifyToken,verifyAgent, async (req, res) => {
      const email = req.params.email
      let query = { 'agent.email': email }
      const result = await propertyCollection.find(query).toArray()
      res.send(result)
    })

    //get all property of agent
    app.get('/manage-property', async (req, res) => {
      const result = await propertyCollection.find().toArray()
      res.send(result)
    })
    // verify
    app.patch('/propertys/status/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          status: 'verified'
        }
      }
      const result = await propertyCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })


    //remove wishlist
    app.patch('/wishlist/remove/:id',verifyToken, async (req, res) => {
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
    app.post('/offered/:id',verifyToken, async (req, res) => {
      const propertyData = req.body
      const result = await offeredCollection.insertOne(propertyData)
      res.send(result)
    })

    //get the data from data base 
    app.get('/offer',verifyToken, async (req, res) => {
      const result = await offeredCollection.find().toArray()
      res.send(result)
    })

    //review
    app.post('/review/:id',verifyToken, async (req, res) => {
      const reviewData = req.body
      const result = await ReviewCollection.insertOne(reviewData)
      res.send(result)
    })
    app.get('/reviews',verifyToken, async (req, res) => {
      const result = await ReviewCollection.find().toArray()
      res.send(result)
    })
    //get offer data
    app.get('/offers', async (req, res) => {
      const result = await offeredCollection.find().toArray()
      res.send(result)
    })

    //delete an offer
    app.patch('/offers/delete/:id',verifyToken,verifyAgent, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          status: 'Rejected'
        }
      }
      const result = await offeredCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })
    // update status of an offer
    app.patch('/offer/status/:id',verifyToken,verifyAgent, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const acceptedOffer = await offeredCollection.findOne(filter);
      if (!acceptedOffer) {
        return res.status(404).send({ message: 'Offer not found' });
      }
      // Update the accepted offer
      const updatedDoc = {
        $set: {
          status: 'Accepted'
        }
      };
      const result = await offeredCollection.updateOne(filter, updatedDoc);
      // Reject all other offers for the same property
      const rejectedFilter = {
        _id: { $ne: new ObjectId(id) },
        propertyId: acceptedOffer.propertyId
      };
      const rejectUpdate = {
        $set: {
          status: 'Rejected'
        }
      };
      await offeredCollection.updateMany(rejectedFilter, rejectUpdate);
      res.send(result)
    })

    //delete review
    app.delete('/reviews/delete/:id',verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await ReviewCollection.deleteOne(query)
      res.send(result)
    })




    //reject
    app.delete('/manage-propertys/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await propertyCollection.deleteOne(query)
      res.send(result)
    })

    //delete a property data 
    app.delete('/property/:id',verifyToken,verifyAgent, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await propertyCollection.deleteOne(query)
      res.send(result)
    })
    //update property data
    app.put('/property/update/:id',verifyToken,verifyAgent, async (req, res) => {
      const id = req.params.id
      const propertyData = req.body
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: propertyData,
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


app.get('/', (req, res) => {
  res.send('real state')
})
app.listen(port, () => {
  console.log(`Real state ${port}`);
})