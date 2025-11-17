const { createHandler } = require('@app-core/server');
const parseInstruction = require('@app/services/payment-processor/parse-instruction');

module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',
  middlewares: [],
  async handler(rc, helpers) {
    const payload = { ...rc.body };

    try {
      const result = await parseInstruction(payload);
      const { httpStatus, body } = result;

      // Map to HTTP status codes required by assessment
      if (httpStatus === 200) {
        return {
          status: helpers.http_statuses.HTTP_200_OK,
          data: body,
        };
      }

      return {
        status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
        data: body,
      };
    } catch (err) {
      // Unexpected errors -> return 400 with generic malformed response
      const body = {
        type: null,
        amount: null,
        currency: null,
        debit_account: null,
        credit_account: null,
        execute_by: null,
        status: 'failed',
        status_reason: 'Malformed instruction: unable to parse keywords',
        status_code: 'SY03',
        accounts: [],
      };
      return {
        status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
        data: body,
      };
    }
  },
});
