# Project Setup Instructions

## API Key

This project requires a Google Gemini API key to function.

1.  Create a file named `.env` in the root of the project directory.
2.  Add your API key to this file as follows:

```
GEMINI_API_KEY="YOUR_API_KEY_HERE"
```

## Solscan API Key (Required for Crypto Tools)

To enable the live token ticker and all crypto-related tools, you must provide a Solscan Pro API key.

1.  In your `.env` file, add the following line, replacing the placeholder with your actual key from [Solscan](https://pro.solscan.io/):
```
SOLSCAN_API_KEY="YOUR_SOLSCAN_API_KEY_HERE"
```

## Database Connection (Required for Agent Creation)

To enable the custom AI agent creation and sharing features, you must provide a MongoDB connection string. We recommend using a free tier from [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register).

1.  In your `.env` file, add the following line, replacing the placeholder with your actual connection string from Atlas:
```
MONGODB_URI="mongodb+srv://<user>:<password>@your-cluster.mongodb.net/yourDatabaseName?retryWrites=true&w=majority"
```

Without this, the agent creation features will not work.

## Dynamic Animations

This project now supports dynamic animations for the 3D avatar. The avatar will switch between an "idle" and a "talking" animation based on the chat's state.

To enable this feature, you **must** provide two animation files:

1.  Create a folder named `public` at the root of your project if it doesn't exist.
2.  Inside `public`, create a folder named `animations`.
3.  Place your idle animation file in this folder and name it `idle_loop.vrma`.
4.  Place your talking animation file in this folder and name it `talk.vrma`.
5. You can also add `idle.vrma` and `idle2.vrma` for more varied idle animations.

The final paths should be:
- `/public/animations/idle_loop.vrma`
- `/public/animations/talk.vrma`

If these files are not found, the avatar may not animate correctly and you will see errors in the browser console. You can find sample VRM animations online or create your own.