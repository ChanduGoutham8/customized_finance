# Automating Firebase setup with the Claude in Chrome extension

This project needs a real Firebase project (Auth + Firestore) before it actually works
— that step needs your Google login, which Claude Code (the CLI/VS Code assistant)
can't do on its own. The **Claude in Chrome** browser extension can, because it runs
inside your real, already-logged-in Chrome.

## How to use this

1. Install/open the Claude in Chrome extension if you haven't already.
2. Copy the prompt in the box below and give it to Claude in Chrome as a task.
3. It will pause and ask you to confirm the parts that create things or submit forms
   (creating the project, enabling sign-in, creating the database) — that's expected,
   approve each one as it comes up.
4. When it's done, it will show you the Firebase config values and the confirmation
   that the security rules were published. Copy the config back here (paste it into
   this chat, or directly into `js/config.js`) so the app can actually connect.

---

## Prompt to give Claude in Chrome

```
Go to https://console.firebase.google.com and help me set up a new Firebase project
for a personal ledger app.

1. Create a new Firebase project. Suggest the name "ledger-<random suffix>" if I
   don't give you one, and ask me to confirm the name before creating it. Skip
   Google Analytics for this project (not needed).

2. Once the project exists, go to Build → Authentication → Get started, and enable
   the "Email/Password" sign-in provider. Leave "Email link" off.

3. Go to Build → Firestore Database → Create database. Choose production mode
   (locked rules to start) and pick a region close to me (ask me if you're not sure
   which one, or default to a common one like eu-west or us-central and tell me
   which you picked).

4. Go to Project settings (gear icon) → General → scroll to "Your apps" → click the
   web icon (</>) to register a new web app. Name it "ledger". You do not need to
   set up Firebase Hosting.

5. Show me the resulting firebaseConfig object (apiKey, authDomain, projectId,
   storageBucket, messagingSenderId, appId) in full so I can copy it — I need every
   field.

6. Go to Build → Firestore Database → Rules tab. Replace the existing rules with
   exactly this, then click Publish:

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }

7. Confirm back to me once the rules show as published, and give me a final summary:
   project name, project ID, and the full config object.

Do not enter any payment details or upgrade the Firebase plan — the free Spark plan
is enough for this. Ask me before anything that isn't listed above.
```

---

## After you have the config

Paste the `firebaseConfig` values into [js/config.js](js/config.js), replacing the
`REPLACE_ME` placeholders — or hand them back to Claude Code in this project and ask
it to do the paste for you. Then reload the app; sign-up/sign-in should work.
