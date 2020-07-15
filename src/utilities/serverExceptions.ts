export const baseUrl = `http://${process.env.HOST}:${process.env.PORT}`;

export const STATUS_CODE = {
    SUCCESS: 200,
    NOT_AUTHENTICATED: 401,
    BAD_REQUEST: 400,
    // 422 Unprocessable Entity (WebDAV): https://www.restapitutorial.com/httpstatuscodes.html
    // SO suggestion: https://stackoverflow.com/a/10323055/9814131
    PARAMETER_REQUIREMENT_NOT_MET: 422,

    INTERNAL_ERROR: 500
};

export class ErrorResponse extends Error {
    public status: number;

    constructor (
        message = 'Server responded error',
        status = STATUS_CODE.BAD_REQUEST
    ) {
        super(message);

        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ErrorResponse);
        }

        this.message = message;
        this.status = status;
    }
}

export class ServerError extends ErrorResponse {
    constructor (
        message = 'An error occured on the server side',
        status = STATUS_CODE.INTERNAL_ERROR
    ) {
        super(message, status);
    }
}

export class NotAuthenticatedResponse extends ErrorResponse {
    constructor (
        message = 'No permission',
        status = STATUS_CODE.NOT_AUTHENTICATED
    ) {
        super(message, status);
    }
}

export class ParameterRequirementNotMet extends ErrorResponse {
    constructor (
        message = 'Parameter requirement not met',
        status = STATUS_CODE.PARAMETER_REQUIREMENT_NOT_MET
    ) {
        super(message, status);
    }
}

export const getErrorAsString = (error: any) => {
    if (typeof error === 'string') {
        return error;
    } else if (error instanceof Error) {
        return error.message;
    } else {
        try {
            return JSON.stringify(error);
        } catch (error) {
            return '(error not able to be stringified)';
        }
    }
};
