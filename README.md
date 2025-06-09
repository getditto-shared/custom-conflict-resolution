# Overview

There are multiple ways to implement custom conflict resolution logic in Ditto.

By default, Ditto will inspect writes on the same property and compare logical timestamps in order to resolve conflicts. This is called last-write-wins. This approach is very efficient and works similarly to HTTP-backed centralized databases, with one extra improvement. Instead of resolving writes at the server, where writes are ordered based on the time they are received, Ditto resolves them based on the time they were *written*. This is beneficial because it reduces complexity needed on the application layer, as end-users can reason about conflicts much more easily. This means that writes are ordered based on each device's hybrid logical clock, even when disconnected. Writes that are old are garbage collected to maintain performance. This works the same as in other centralized systems where old data is discarded. This works well for the majority of use cases and is more performant compared to  op-logs which keep the entire history of the database.

However, there are some scenarios in which you may want more direct control over data provenance. In traditional databases like Oracle or PostgreSQL, a "Materialized View" is a database object that contains the results of a query. It's like a pre-computed table that can be queried just like a regular table, often used for performance or to simplify complex queries. While Ditto doesn't have a built-in "Materialized View" object in the same way, we can achieve a similar outcome at the application layer. In Ditto, this means reading data from one or more collections, applying custom logic (like conflict resolution or data transformation), and then "materializing" this combined or transformed view in memory for the UI to consume. This is typically done in response to data changes observed from Ditto's store.

This demo application showcases a **custom, role-based conflict resolution system**. It utilizes two collections: `tasks` and `tasks_overrides`. Junior users write to the `tasks` collection, while Senior users write to the `tasks_overrides` collection. The app then applies custom logic client-side to combine data from both collections, with override tasks always taking precedence over regular tasks when they share the same ID. This combined dataset, effectively a "materialized view" for the UI, demonstrates how to implement custom business logic for data merging while maintaining the performance benefits of Ditto's native conflict resolution within each individual collection.

### Caveats

Implementing custom conflict resolution at the application layer, similar to materialized views, has tradeoffs:

- This example resolves the latest version of the data after reading from both collections. If you want the authoritative source of truth to exist in a particular collection, we recommend implementing this logic as a response to the change data capture from Ditto server, or as a trigger in MongoDB.
- The conflict resolution happens at the application layer, which means each peer must implement the same logic to ensure consistency across all devices.
- Performance can be impacted when dealing with large datasets since the merge operation happens on every observer callback.
- This pattern works best for scenarios where Senior users have authority over Junior users' data, but may not be suitable for all collaborative editing use cases.

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
