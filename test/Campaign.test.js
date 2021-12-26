const assert = require('assert')
const ganache = require('ganache-cli')
const Web3 = require('web3')

const web3 = new Web3(ganache.provider())

const compiledFactory = require('../ethereum/build/CampaignFactory.json')
const compiledCampaign = require('../ethereum/build/Campaign.json')

const millionWei = '1000000'
const minimumContributionWei = '100'
let accounts
let factory
let campaignAddress
let campaign
let manager
let recipient
let approver
const description = 'Sample description'
const valueOfRequest = millionWei + '000'

beforeEach(async () => {
    accounts = await web3.eth.getAccounts()
    manager = accounts[1]
    recipient = accounts[3]
    approver = accounts[4]
    factory = await new web3.eth.Contract(JSON.parse(compiledFactory.interface))
        .deploy({data: compiledFactory.bytecode}).send({from: accounts[0], gas: millionWei})

    await factory.methods.createCampaign('100').send({
        from: manager,
        gas: millionWei
    })

    const campaignAddresses = await factory.methods.getDeployedCampaigns().call()

    campaignAddress = campaignAddresses[0]

    campaign = await new web3.eth.Contract(JSON.parse(compiledCampaign.interface), campaignAddress)
})

describe('Campaign', () => {
    describe('CampaignFactory contract', () => {
        it('deploys a CampaignFactory', () => {
            assert.ok(factory.options.address)
        })
    })

    describe('Campaign contract', () => {
        it('deploys a Campaign', () => {
            assert.ok(campaign.options.address)
        })

        it('deploys a Campaign with the correct manager', async () => {
            const actual = await campaign.methods.manager().call()
            assert.equal(actual, manager)
        })

        it('allows an approver to contribute with the minimum contribution amount', async () => {
            await campaign.methods.contribute().send({
                from: approver,
                value: minimumContributionWei
            })
            const [isApprover, approversCount] = await Promise.all([
                campaign.methods.approvers(approver).call(),
                campaign.methods.approversCount().call()
            ])

            assert(isApprover)
            assert.equal(approversCount, 1)
        })

        it('does not allow an approver to contribute with less than the minimum contribution amount', async () => {
            const value = Number(minimumContributionWei) - 1
            try {
                await campaign.methods.contribute().send({
                    from: approver,
                    value: value.toString()
                })
                assert(false)
            } catch (err) {
                assert(err)
            }
            const [isApprover, approversCount] = await Promise.all([
                campaign.methods.approvers(approver).call(),
                campaign.methods.approversCount().call()
            ])

            assert(!isApprover)
            assert.equal(approversCount, 0)
        })

        it('allows the manager to make a payment request', async () => {
            const complete = false
            const approvalCount = 0
            await campaign.methods.createRequest(description, valueOfRequest, recipient).send({
                from: manager,
                gas: millionWei
            })
            const request = await campaign.methods.requests(0).call()
            const {
                description: actualDescription,
                value: actualValue,
                recipient: actualRecipient,
                complete: actualComplete,
                approvalCount: actualApprovalCount
            } = request

            assert.equal(actualDescription, description)
            assert.equal(actualValue, valueOfRequest)
            assert.equal(actualRecipient, recipient)
            assert.equal(actualComplete, complete)
            assert.equal(actualApprovalCount, approvalCount)
            assert.ok(!actualComplete)
        })

        it('does now allow a non-manager to make a payment request', async () => {
            const value = millionWei + '000'
            try {
                await campaign.methods.createRequest(description, value, recipient).send({
                    from: accounts[5],
                    gas: millionWei
                })
                assert(false)
            } catch (err) {
                assert(err)
            }
        })

        it('allows an approver to approve a payment request', async () => {
            // 1) contribute to campaign
            await campaign.methods.contribute().send({
                value: web3.utils.toWei('1', 'ether'),
                from: approver
            })
            // 2) manager creates a request
            await campaign.methods.createRequest(description, valueOfRequest, recipient).send({
                from: manager,
                gas: millionWei
            })
            // 3) approver approves request
            await campaign.methods.approveRequest(0).send({
                from: approver,
                gas: millionWei
            })

            const [approverExists, {approvalCount}] = await Promise.all([
                campaign.methods.approvers(approver).call(),
                campaign.methods.requests(0).call()
            ])

            assert.ok(approverExists)
            assert.equal(approvalCount, 1)
        })

        it('does not allow an non-approver to approve a payment request', async () => {

            // 1) manager creates a request
            await campaign.methods.createRequest(description, valueOfRequest, recipient).send({
                from: manager,
                gas: millionWei
            })
            try {
                // 2) non-approver attempts to approve request
                await campaign.methods.approveRequest(0).send({
                    from: approver,
                    gas: millionWei
                })
                assert(false)
            } catch (err) {
                assert(err)
            }

            const { approvalCount } = await campaign.methods.requests(0).call()

            assert.equal(approvalCount, 0)
        })

        it('allows the manager to finalize a payment request', async () => {
            const initialRecipientBalance = await web3.eth.getBalance(recipient)

            // 1) contribute to campaign
            await campaign.methods.contribute().send({
                value: web3.utils.toWei('1', 'ether'),
                from: approver
            })
            // 2) manager creates a request
            await campaign.methods.createRequest(description, valueOfRequest, recipient).send({
                from: manager,
                gas: millionWei
            })
            // 3) approver approves request
            await campaign.methods.approveRequest(0).send({
                from: approver,
                gas: millionWei
            })

            // 4) manager finalizes request
            await campaign.methods.finalizeRequest(0).send({
                from: manager,
                gas: millionWei
            })

            const [{complete}, actualRecipientBalance] = await Promise.all([
                campaign.methods.requests(0).call(),
                web3.eth.getBalance(recipient)
            ])

            const expectedRecipientBalance = Number(initialRecipientBalance) + Number(valueOfRequest)

            assert.ok(complete)
            assert.equal(actualRecipientBalance, expectedRecipientBalance.toString())
        })

        it('does not allow a non-manager to finalize a payment request', async () => {
            const initialRecipientBalance = await web3.eth.getBalance(recipient)

            // 1) contribute to campaign
            await campaign.methods.contribute().send({
                value: web3.utils.toWei('1', 'ether'),
                from: approver
            })
            // 2) manager creates a request
            await campaign.methods.createRequest(description, valueOfRequest, recipient).send({
                from: manager,
                gas: millionWei
            })
            // 3) approver approves request
            await campaign.methods.approveRequest(0).send({
                from: approver,
                gas: millionWei
            })

            try {
                // 4) NON-manager attempts to finalize request
                await campaign.methods.finalizeRequest(0).send({
                    from: accounts[5],
                    gas: millionWei
                })
                assert(false)
            } catch (err) {
                assert(err)
            }

            const [{complete}, actualRecipientBalance] = await Promise.all([
                campaign.methods.requests(0).call(),
                web3.eth.getBalance(recipient)
            ])

            assert.ok(!complete)
            assert.equal(initialRecipientBalance, actualRecipientBalance)
        })
    })
})


