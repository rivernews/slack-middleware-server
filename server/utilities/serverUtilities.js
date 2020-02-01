const baseUrl = `http://${process.env.HOST}:${process.env.PORT}`;

const STATUS_CODE = {
    SUCCESS: 200,
    NOT_AUTHENTICATED: 401,

    // 422 Unprocessable Entity (WebDAV): https://www.restapitutorial.com/httpstatuscodes.html
    // SO suggestion: https://stackoverflow.com/a/10323055/9814131
    PARAMETER_REQUIREMENT_NOT_MET: 422,
};

module.exports = {
    baseUrl,
    STATUS_CODE
};