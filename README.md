# Ditto JS Web Quickstart App 🚀

This directory contains Ditto's quickstart app for in-browser web applications.
This app uses Vite along with Typescript and React, and shows how to include
the Ditto SDK in a client-side app running in the browser.

## Overview

There are multiple ways to implement custom conflict resolution logic in Ditto.

By default Ditto will inspect writes ont he same property and compare logica
timestamps in order to resolve conflicts. This is called last-write-wins. This
is very efficient and works similarly to HTTP-backed centralized databases, with 
one extra improvement. Instead of resolving writes at the server,  where writes
are based on the time they are received, Ditto resolves them based on the time
they were *written*. This is beneifical because it reduces complexity
needed on the application layer, as end-users can reason about conflicts much
easie. This means that writes are written in order based on each device's
hybrid logical clock, even when disconnected. Writes that are old are garbage
collected to maintain performance. This works the same in other centralized
systems where old data is discarded. This well for the majority of use cases
and is more performant compared to operational transforms or op-logs which keep
the entire history of the database.

However, there some scenarios in which you may want more direct control over
data provenance. In a typical MongoDB-backed system, you'd write an HTTP
middleware layer that stitches together data to provide a stable source of
truth. In Ditto

## Getting Started

To get started, you'll first need to create an app in the [Ditto Portal][0]
with the "Online Playground" authentication type. You'll need to find your
AppID and Playground Token in order to use this quickstart.

[0]: https://portal.ditto.live

From the repo root, copy the `.env.sample` file to `.env`, and fill in the
fields with your AppID and Playground Token:

```
cp .sample.env .env
```

The `.env` file should look like this (with your fields filled in):

```bash
#!/usr/bin/env bash

# Copy this file from ".env.sample" to ".env", then fill in these values
# A Ditto AppID, Playground token, Auth URL, and Websocket URL can be obtained from https://portal.ditto.live
DITTO_APP_ID=""
DITTO_PLAYGROUND_TOKEN=""
DITTO_AUTH_URL=""
DITTO_WEBSOCKET_URL=""
```

Next, run the quickstart app with the following command:

```
npm && npm run dev
```
