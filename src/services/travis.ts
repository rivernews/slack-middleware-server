import axios from 'axios';

const getTravisCiRequestHeaders = () => {
    return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Travis-API-Version': '3',
        Authorization: 'token ' + process.env.TRAVIS_TOKEN
    };
};

export const asyncTriggerQualitativeReviewRepoBuild = async (
    companyInformationString: string
) => {
    const username = 'rivernews';
    const repo = 'review-scraper-java-development-environment';
    const fullRepoName = `${username}/${repo}`;
    const urlEncodedRepoName = encodeURIComponent(fullRepoName);

    return axios.post(
        `https://api.travis-ci.com/repo/${urlEncodedRepoName}/requests`,
        {
            config: {
                env: {
                    TEST_COMPANY_INFORMATION_STRING: companyInformationString
                }
            }
        },
        {
            headers: getTravisCiRequestHeaders()
        }
    );
};
