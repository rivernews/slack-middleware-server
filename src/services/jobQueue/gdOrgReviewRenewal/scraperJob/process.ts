import Bull = require('bull');

// Sandbox threaded job
// https://github.com/OptimalBits/bull#separate-processes

module.exports = function (job: Bull.Job<any>, done: Bull.DoneCallback) {
    const data = job.data;

    // Do some heavy work
    const result = {
        data: 'nice'
    };

    // sub channel

    // POST travis API

    console.log('scraper did some work at', new Date());

    done(null, result);
    // return Promise.resolve(result);
};
