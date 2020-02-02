const baseUrl = `http://${process.env.HOST}:${process.env.PORT}`;

const STATUS_CODE = {
    SUCCESS: 200,
    NOT_AUTHENTICATED: 401,

    BAD_REQUEST: 400,

    // 422 Unprocessable Entity (WebDAV): https://www.restapitutorial.com/httpstatuscodes.html
    // SO suggestion: https://stackoverflow.com/a/10323055/9814131
    PARAMETER_REQUIREMENT_NOT_MET: 422
};

class ErrorResponse extends Error {
    constructor(
        message = 'Server responded error',
        status = STATUS_CODE.BAD_REQUEST
    ) {
        super(message);
        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ErrorResponse);
        }

        this.status = status;
    }
}

class NotAuthenticatedResponse extends ErrorResponse {
    constructor(
        message = 'No permission',
        status = STATUS_CODE.NOT_AUTHENTICATED
    ) {
        super(message, status);
    }
}

class ParameterRequirementNotMet extends ErrorResponse {
    constructor(
        message = 'Parameter requirement not met',
        status = STATUS_CODE.PARAMETER_REQUIREMENT_NOT_MET
    ) {
        super(message, status);
    }
}

module.exports = {
    baseUrl,
    STATUS_CODE,

    ErrorResponse,
    NotAuthenticatedResponse,
    ParameterRequirementNotMet
};
