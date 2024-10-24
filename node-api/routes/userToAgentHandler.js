const express = require('express');
const router = express.Router();
const { loginAndGetAuthToken, createOmnichannelContact, createLiveChatRoom } = require('../utils/rocketChat');
const { generateRandomToken } = require('../utils/helpers');
const roomManager = require('../utils/roomManager');

let lastMessageId = null;
let lastProcessedUserMessageId = null;
const botUsername = 'rocket.cat';

router.post('/', async (req, res) => {
    console.log('--- [userToAgent] --- Outgoing webhook from user was triggered.');

    const message = req.body;
    const sender_id = message.user_id || "unknown";
    const sender_username = message.user_name || "unknown";
    const message_text = message.text || "No message";
    const room_id = message.channel_id || "unknown";
    const message_id = message.message_id || "unknown";
    const isSystemMessage = message.isSystemMessage || false;

    console.log(`--- [userToAgent] --- Received message details: sender_id="${sender_id}", sender_username="${sender_username}", message_text="${message_text}", room_id="${room_id}", message_id="${message_id}"`);

    if (message_id === lastMessageId) {
        console.log('--- [userToAgent] --- Duplicate message received, ignoring.');
        return res.status(200).send('Duplicate message ignored.');
    }

    if (sender_username === botUsername || isSystemMessage) {
        console.log('--- [userToAgent] --- Message sent by bot or marked as system message, ignoring to prevent loop.');
        return res.status(200).send('Bot message or system message ignored.');
    }

    lastMessageId = message_id;
    lastProcessedUserMessageId = message_id;

    if (roomManager.isTimerRunning(sender_id)) {
        console.log('--- [userToAgent] --- Inactivity timer is running. Resetting timer.');
        roomManager.stopInactivityTimer(sender_id);
    }

    // Store the latest message and time in the roomManager
    roomManager.setLastMessage(sender_id, message_text);
    console.log(`--- [userToAgent] --- Stored latest message: "${message_text}" at ${roomManager.getLastMessageTime(sender_id)}`);

    try {
        // Check if userAuthToken exists for the user
        let authToken = roomManager.getUserAuthToken(sender_id);
        let userId;

        if (!authToken) {
            console.log('--- [userToAgent] --- No auth token found for user, logging in...');
            const loginData = await loginAndGetAuthToken(sender_username);
            authToken = loginData.authToken;
            userId = loginData.userId;
            roomManager.setUserAuthToken(sender_id, authToken);
        } else {
            console.log('--- [userToAgent] --- Auth token found for user.');
            userId = sender_id;  // Use stored userId if authToken exists
        }

        // Capture visitor token for creating the omnichannel contact
        let visitorToken = roomManager.getUserVisitorToken(sender_id);
        if (!visitorToken) {
            visitorToken = generateRandomToken();  // Generate new visitor token
            roomManager.setUserVisitorToken(sender_id, visitorToken);
        }
        console.log(`--- [userToAgent] --- Captured visitor token: ${visitorToken}`);

        // Check if a live chat room already exists
        let liveChatRoomId = roomManager.getLiveChatRoomId(sender_id);
        if (!liveChatRoomId) {
            console.log(`--- [userToAgent] --- No LiveChat room found for user, creating new Omnichannel contact and room.`);

            try {
                // Create Omnichannel Contact using userToken and the correct auth headers
                await createOmnichannelContact(authToken, userId, visitorToken, sender_username);

                // Create a Live Chat Room
                liveChatRoomId = await createLiveChatRoom(authToken, userId, visitorToken);
                roomManager.setLiveChatRoomId(sender_id, liveChatRoomId);
                roomManager.setUserRoomId(sender_id, room_id);

                console.log(`--- [userToAgent] --- Live chat room created successfully with ID: ${liveChatRoomId}`);

                // Send response confirming room creation
                res.status(200).send(`Live chat room created successfully with ID: ${liveChatRoomId}`);
            } catch (error) {
                console.error('--- [userToAgent] --- Error creating Omnichannel contact or live chat room:', error.message);
                return res.status(500).send('Failed to create Omnichannel contact or live chat room.');
            }
        } else {
            console.log(`--- [userToAgent] --- Live chat room already exists with ID: ${liveChatRoomId}.`);
            res.status(200).send(`Live chat room already exists with ID: ${liveChatRoomId}`);
        }
    } catch (error) {
        console.error('--- [userToAgent] --- Error capturing details:', error.message);
        res.status(500).send('Error capturing details.');
    }
});

module.exports = router;
