const index = require('../index');
const slack = require('../services/slack');

index.app.post('/qualitative-org-review/list-org', async (req, res) => {
    console.log('/qualitative-org-review/list-org');
    console.log(req.body);
    console.log(req.query);

    const [searchKeyword, ] = slack.parseArgsFromSlackMessage(req);

    // sanitize
    const sanitizedString = searchKeyword.trim();

    // TODO: query glassdoor

    // TODO: get html page

    // TODO: parse html, find overview evidence

    // TODO: if not overview, ready to parse company url list

    res.send('OK');
});