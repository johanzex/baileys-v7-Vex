import { Boom } from "@hapi/boom";
import { proto } from "../../WAProto/index.js";
import {
    areJidsSameUser,
    isHostedLidUser,
    isHostedPnUser,
    isJidBroadcast,
    isJidGroup,
    isJidMetaAI,
    isJidNewsletter,
    isJidStatusBroadcast,
    isLidUser,
    isPnUser
} from "../WABinary/index.js";
import { unpadRandomMax16 } from "./generics.js";

export const getDecryptionJid = async (sender, repository) => {
    if (isLidUser(sender) || isHostedLidUser(sender)) return sender;
    return (await repository.lidMapping.getLIDForPN(sender)) || sender;
};

const storeMappingFromEnvelope = async (
    stanza,
    sender,
    repository,
    decryptionJid,
    logger
) => {
    const senderPn =
        stanza.attrs.participant_pn ||
        stanza.attrs.sender_pn ||
        stanza.attrs.peer_recipient_pn;

    const senderLid =
        stanza.attrs.participant_lid ||
        stanza.attrs.sender_lid ||
        stanza.attrs.peer_recipient_lid;

    if (senderLid && isPnUser(sender) && decryptionJid === sender) {
        try {
            await repository.lidMapping.storeLIDPNMappings([
                { lid: senderLid, pn: sender }
            ]);
            await repository.migrateSession(sender, senderLid);

            logger.debug(
                { sender, senderLid },
                "Stored LID mapping from envelope"
            );
        } catch (error) {
            logger.warn(
                { sender, senderLid, error },
                "Failed to store LID mapping"
            );
        }
    }
};

export const NO_MESSAGE_FOUND_ERROR_TEXT = "Message absent from node";
export const MISSING_KEYS_ERROR_TEXT = "Key used already or never filled";

export const DECRYPTION_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 100,
    sessionRecordErrors: [
        "No session record",
        "SessionError: No session record"
    ]
};

export const NACK_REASONS = {
    ParsingError: 487,
    UnrecognizedStanza: 488,
    UnrecognizedStanzaClass: 489,
    UnrecognizedStanzaType: 490,
    InvalidProtobuf: 491,
    InvalidHostedCompanionStanza: 493,
    MissingMessageSecret: 495,
    SignalErrorOldCounter: 496,
    MessageDeletedOnPeer: 499,
    UnhandledError: 500,
    UnsupportedAdminRevoke: 550,
    UnsupportedLIDGroup: 551,
    DBOperationFailed: 552
};
export const extractAddressingContext = stanza => {
    let senderAlt;
    let recipientAlt;

    const sender = stanza.attrs.participant || stanza.attrs.from;

    const addressingMode =
        stanza.attrs.addressing_mode || (isLidUser(sender) ? "lid" : "pn");

    senderAlt =
        stanza.attrs.participant_pn ||
        stanza.attrs.sender_pn ||
        stanza.attrs.peer_recipient_pn ||
        null;

    if (!senderAlt) {
        senderAlt =
            stanza.attrs.participant_lid ||
            stanza.attrs.sender_lid ||
            stanza.attrs.peer_recipient_lid;
    }

    recipientAlt = stanza.attrs.recipient_pn || null;

    if (!recipientAlt) {
        recipientAlt = stanza.attrs.recipient_lid || null;
    }

    return {
        addressingMode,
        senderAlt,
        recipientAlt
    };
};
export function decodeMessageNode(stanza, meId, meLid) {
    let msgType;
    let chatId;
    let author;
    let fromMe = false;

    const msgId = stanza.attrs.id;
    const from = stanza.attrs.from;
    const participant = stanza.attrs.participant;
    const recipient = stanza.attrs.recipient;

    const senderPn =
        stanza.attrs.sender_pn ||
        stanza.attrs.participant_pn ||
        stanza.attrs.peer_recipient_pn;

    const senderLid =
        stanza.attrs.sender_lid ||
        stanza.attrs.participant_lid ||
        stanza.attrs.peer_recipient_lid;

    const isMe = jid => areJidsSameUser(jid, meId);
    const isMeLid = jid => areJidsSameUser(jid, meLid);

    if (
        isPnUser(from) ||
        isLidUser(from) ||
        isHostedLidUser(from) ||
        isHostedPnUser(from)
    ) {
        if (recipient && !isJidMetaAI(recipient)) {
            if (!isMe(from) && !isMeLid(from)) {
                throw new Boom("receipient present, but msg not from me", {
                    data: stanza
                });
            }

            if (isMe(from) || isMeLid(from)) fromMe = true;
            chatId = recipient;
        } else {
            chatId = from;
        }

        msgType = "chat";
        author = from;
    } else if (isJidGroup(from)) {
        if (!participant) throw new Boom("No participant in group message");

        if (isMe(participant) || isMeLid(participant)) fromMe = true;

        msgType = "group";
        author = participant;
        chatId = from;
    } else if (isJidBroadcast(from)) {
        if (!participant) throw new Boom("No participant in group message");

        const isParticipantMe = isMe(participant);

        msgType = isJidStatusBroadcast(from)
            ? isParticipantMe
                ? "direct_peer_status"
                : "other_status"
            : isParticipantMe
              ? "peer_broadcast"
              : "other_broadcast";

        fromMe = isParticipantMe;
        chatId = from;
        author = participant;
    } else {
        if (!isJidNewsletter(from)) {
            throw new Boom("Unknown message type", { data: stanza });
        }

        msgType = "newsletter";
        chatId = from;
        author = from;

        if (isMe(from) || isMeLid(from)) fromMe = true;
    }

    const isGroup = isJidGroup(chatId);

    const realParticipant =
        senderPn ||
        (participant && participant.endsWith("@s.whatsapp.net")
            ? participant
            : null);

    const realParticipantLid =
        senderLid ||
        (participant && participant.endsWith("@lid") ? participant : null);

    const participantJid = isGroup ? realParticipant || realParticipantLid || "" : "";
    const participantAlt = isGroup ? (realParticipant && realParticipantLid ? (participantJid === realParticipant ? realParticipantLid : realParticipant) : "") : "";

    const key = {
        remoteJid: isGroup
            ? chatId
            : realParticipant || realParticipantLid || chatId,
        remoteJidAlt: chatId,
        fromMe:
            fromMe ||
            isMe(realParticipant) ||
            isMeLid(realParticipantLid) ||
            false,
        id: msgId,
        participant: participantJid,
        participantAlt: participantAlt,
        participantPn: realParticipant,
        participantLid: realParticipantLid
    };

    const fullMessage = {
        key,
        category: stanza.attrs.category,
        messageTimestamp: +stanza.attrs.t,
        pushName: stanza.attrs.notify,
        broadcast: isJidBroadcast(from)
    };

    if (key.fromMe) {
        fullMessage.status = proto.WebMessageInfo.Status.SERVER_ACK;
    }

    return {
        fullMessage,
        author,
        sender: msgType === "chat" ? author : chatId
    };
}

export const decryptMessageNode = (stanza, meId, meLid, repository, logger) => {
    const { fullMessage, author, sender } = decodeMessageNode(
        stanza,
        meId,
        meLid
    );

    return {
        fullMessage,
        category: stanza.attrs.category,
        author,

        async decrypt() {
            let decryptables = 0;

            if (Array.isArray(stanza.content)) {
                for (const { tag, attrs, content } of stanza.content) {
                    if (tag !== "enc" && tag !== "plaintext") continue;
                    if (!(content instanceof Uint8Array)) continue;

                    decryptables++;

                    const decryptionJid = await getDecryptionJid(
                        author,
                        repository
                    );

                    if (tag !== "plaintext") {
                        await storeMappingFromEnvelope(
                            stanza,
                            author,
                            repository,
                            decryptionJid,
                            logger
                        );
                    }

                    try {
                        const e2eType =
                            tag === "plaintext" ? "plaintext" : attrs.type;

                        let msgBuffer;

                        switch (e2eType) {
                            case "skmsg":
                                msgBuffer =
                                    await repository.decryptGroupMessage({
                                        group: sender,
                                        authorJid: author,
                                        msg: content
                                    });
                                break;

                            case "pkmsg":
                            case "msg":
                                msgBuffer = await repository.decryptMessage({
                                    jid: decryptionJid,
                                    type: e2eType,
                                    ciphertext: content
                                });
                                break;

                            case "plaintext":
                                msgBuffer = content;
                                break;

                            default:
                                throw new Error(`Unknown e2e type: ${e2eType}`);
                        }

                        let msg = proto.Message.decode(
                            e2eType !== "plaintext"
                                ? unpadRandomMax16(msgBuffer)
                                : msgBuffer
                        );

                        msg = msg.deviceSentMessage?.message || msg;

                        await normalizeQuoted(msg, repository);

                        if (fullMessage.message) {
                            Object.assign(fullMessage.message, msg);
                        } else {
                            fullMessage.message = msg;
                        }
                    } catch (err) {
                        logger.error(
                            { key: fullMessage.key, err },
                            "failed to decrypt message"
                        );

                        fullMessage.messageStubType =
                            proto.WebMessageInfo.StubType.CIPHERTEXT;

                        fullMessage.messageStubParameters = [
                            err.message.toString()
                        ];
                    }
                }
            }

            if (!decryptables) {
                fullMessage.messageStubType =
                    proto.WebMessageInfo.StubType.CIPHERTEXT;

                fullMessage.messageStubParameters = [
                    NO_MESSAGE_FOUND_ERROR_TEXT
                ];
            }
        }
    };
};

async function normalizeQuoted(msg, repo) {
    const ctx =
        msg?.extendedTextMessage?.contextInfo ||
        msg?.imageMessage?.contextInfo ||
        msg?.videoMessage?.contextInfo;

    if (!ctx?.participant) return;

    if (ctx.participant.endsWith("@lid")) {
        const pn = await repo.lidMapping.getPNForLID(ctx.participant);
        if (pn) ctx.participant = pn;
    }
}
