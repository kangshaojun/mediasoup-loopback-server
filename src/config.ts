import {
    RtpCodecCapability,
    TransportListenIp,
    WorkerLogTag,
} from "mediasoup/node/lib/types";

export const config = {
    httpIp: "0.0.0.0",
    httpPort: 3000,
    httpPeerStale: 360000,

    mediasoup: {
        worker: {
            rtcMinPort: 10000,
            rtcMaxPort: 10100,
            logLevel: "debug",
            logTags: [
                "info",
                "ice",
                "dtls",
                "rtp",
                "srtp",
                "rtcp",
                // 'rtx',
                // 'bwe',
                // 'score',
                // 'simulcast',
                // 'svc'
            ] as WorkerLogTag[],
        },
        router: {
            mediaCodecs:
                [
                    {
                        kind: 'audio',
                        mimeType: 'audio/opus',
                        clockRate: 48000,
                        channels: 2
                    },
                    {
                        kind: 'video',
                        mimeType: 'video/VP8',
                        clockRate: 90000,
                        parameters:
                            {
                                'x-google-start-bitrate': 1000
                            }
                    },
                ] as RtpCodecCapability[],
        },

        // rtp listenIps are the most important thing, below. you'll need
        // to set these appropriately for your network for the demo to
        // run anywhere but on localhost
        webRtcTransport: {
            listenIps: [
                {
                    ip: '0.0.0.0',
                    announcedIp:'127.0.0.1'
                }
            ] as TransportListenIp[],
            maxIncomingBitrate: 1500000,
            initialAvailableOutgoingBitrate: 800000,
        },
    },
} as const;
