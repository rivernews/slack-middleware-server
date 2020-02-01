'use strict';

const express = require('express');

// Constants
const PORT = parseInt(process.env.PORT);
const HOST = process.env.HOST;

// App
const app = express();

// App Config
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

// App Routes

app.get('/', async (req, res) => {
    res.send('Hello! This is our slack service.');
});
app.use(require('./QualitativeOrgReview/routes').baseUrl, require('./QualitativeOrgReview/routes').qualitativeOrgReviewRouter);


// TODO: explore travisCI API
// https://developer.travis-ci.com/resource/requests#Requests

// Bootstrap server

const nodeServer = app.listen(PORT, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
});

module.exports = nodeServer;