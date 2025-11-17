const request = require('supertest');
const { expect } = require('chai');
const { createServer } = require('@app-core/server');

describe('integration: /payment-instructions', function () {
  this.timeout(10000);
  let server;
  let appHandler;

  before(() => {
    server = createServer({ JSONLimit: '1mb', enableCors: false });
    // register handler directly
    // require the handler module which exports a createHandler result
    // The handler file registers path '/payment-instructions'
    // eslint-disable-next-line global-require
    const handler = require('../../endpoints/payment-instructions/process');
    server.addHandler(handler);
    appHandler = server.executeRequest; // function(req,res,next)
  });

  it('executes DEBIT immediate (happy path) via HTTP', async () => {
    const payload = {
      accounts: [
        { id: 'N90394', balance: 1000, currency: 'USD' },
        { id: 'N9122', balance: 500, currency: 'USD' },
      ],
      instruction: 'DEBIT 500 USD FROM ACCOUNT N90394 FOR CREDIT TO ACCOUNT N9122',
    };

    const res = await request(appHandler).post('/payment-instructions').send(payload).expect(200);
    expect(res.body).to.be.an('object');
    const { data } = res.body;
    expect(data.status).to.equal('successful');
    expect(data.status_code).to.equal('AP00');
    expect(data.accounts[0].balance).to.equal(500);
  });

  it('returns pending for future dated CREDIT instruction via HTTP', async () => {
    const payload = {
      accounts: [
        { id: 'acc-001', balance: 1000, currency: 'NGN' },
        { id: 'acc-002', balance: 500, currency: 'NGN' },
      ],
      instruction: 'CREDIT 300 NGN TO ACCOUNT acc-002 FOR DEBIT FROM ACCOUNT acc-001 ON 2999-12-31',
    };

    const res = await request(appHandler).post('/payment-instructions').send(payload).expect(200);
    const { data } = res.body;
    expect(data.status).to.equal('pending');
    expect(data.status_code).to.equal('AP02');
    expect(data.accounts[0].balance).to.equal(1000);
    expect(data.accounts[1].balance).to.equal(500);
  });

  it('returns 400 for currency mismatch via HTTP', async () => {
    const payload = {
      accounts: [
        { id: 'a', balance: 100, currency: 'USD' },
        { id: 'b', balance: 500, currency: 'GBP' },
      ],
      instruction: 'DEBIT 50 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
    };

    const res = await request(appHandler).post('/payment-instructions').send(payload).expect(400);
    const { data } = res.body;
    expect(data.status_code).to.equal('CU01');
  });
});
