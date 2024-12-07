import * as mediasoup from "mediasoup";
import http from 'http';
import express, { Express, Request, Response, NextFunction } from 'express';
import {Server} from 'socket.io';

import { config } from './config';
import { 
  Producer,
  Worker,
  Router,
  Transport,
  Consumer,
  WebRtcTransport 
} from "mediasoup/node/lib/types";

let worker: Worker;
let webServer: http.Server;
let socketServer: Server;
let expressServer: Express;
let producer: Producer;
let consumer: Consumer;
let producerTransport: Transport;
let consumerTransport: Transport;
let mediasoupRouter: Router;

(async () => {
  try {
    await runServer();
    await runSocketServer();
    await runMediasoupWorker();
  } catch (err) {
    console.error(err);
  }
})();

async function runServer(): Promise<void> {
  expressServer = express();
  expressServer.use(express.json());
  expressServer.use(express.static(__dirname));

  expressServer.use((error: Error, req: Request, res: Response, next: NextFunction) => {
    if (error) {
      console.warn('Express app error,', error.message);

      const status = error.name === 'TypeError' ? 400 : 500;
      console.log("log:",req);

      res.statusMessage = error.message;
      res.status(status).send(String(error));
    } else {
      next();
    }
  });

  webServer = http.createServer(expressServer);
  webServer.on('error', (err: Error) => {
    console.error('starting web server failed:', err.message);
  });

  await new Promise<void>((resolve) => {
    const { listenIp, listenPort } = {"listenIp":"localhost",listenPort: 8000}//config;
    webServer.listen(listenPort, listenIp, () => {
      console.log('server is running');
      console.log(`open http://${listenIp}:${listenPort} in your web browser`);
      resolve();
    });
  });
}

async function runSocketServer(): Promise<void> {

  socketServer = new Server(webServer);

  socketServer.on('connection', (socket) => {
    console.log('client connected');

    if (producer) {
      socket.emit('newProducer');
    }

    socket.on('disconnect', () => {
      console.log('client disconnected');
    });

    socket.on('connect_error', (err: Error) => {
      console.error('client connection error', err);
    });

    socket.on('getRouterRtpCapabilities', (data: any, callback: (err: any, rtpCapabilities?: any) => void) => {
      console.log("log:",data);
      if (!mediasoupRouter) {
        callback(new Error('mediasoupRouter not ready'));
        return;
      }

      callback(null, mediasoupRouter.rtpCapabilities);
    });

    socket.on('createProducerTransport', async (data: any, callback: (err: any, params?: any) => void) => {
      console.log("log:",data);
      try {
        const { transport, params } = await createWebRtcTransport();
        producerTransport = transport;
        callback(null, params);
      } catch (err) {
        console.error(err);
        callback(err);
      }
    });

    socket.on('createConsumerTransport', async (data: any, callback: (err: any, params?: any) => void) => {
      console.log("log:",data);
      try {
        const { transport, params } = await createWebRtcTransport();
        consumerTransport = transport;
        callback(null, params);
      } catch (err) {
        console.error(err);
        callback(err);
      }
    });

    socket.on('connectProducerTransport', async (data: any, callback: (err?: any) => void) => {
      await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on('connectConsumerTransport', async (data: any, callback: (err?: any) => void) => {
      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on('produce', async (data: any, callback: (err: any, id?: string) => void) => {
      const {kind, rtpParameters} = data;
      producer = await producerTransport.produce({ kind, rtpParameters });
      callback(null, producer.id);

      // inform clients about new producer
      socket.broadcast.emit('newProducer');
    });

    socket.on('consume', async (data: any, callback: (err: any, params?: any) => void) => {
      if (!producer) {
        callback(new Error('no producer'));
        return;
      }

      const {rtpCapabilities} = data;
      try {
        const params = await createConsumer(producer, rtpCapabilities);
        callback(null, params);
      } catch (err) {
        console.error(err);
        callback(err);
      }
    });

    socket.on('resume', async (data: any, callback: (err?: any) => void) => {
      console.log("log:",data);
      await consumer.resume();
      callback();
    });
  });
}

async function runMediasoupWorker(): Promise<void> {
  worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.worker.logLevel,
    logTags: config.mediasoup.worker.logTags,
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
  });

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });

  const mediaCodecs = config.mediasoup.router.mediaCodecs;
  mediasoupRouter = await worker.createRouter({ mediaCodecs });
}

async function createWebRtcTransport(): Promise<{ transport: WebRtcTransport, params: any }> {
  const {
    maxIncomingBitrate,
    initialAvailableOutgoingBitrate
  } = config.mediasoup.webRtcTransport;

  const transport = await mediasoupRouter.createWebRtcTransport({
    listenIps: config.mediasoup.webRtcTransport.listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate,
  });

  if (maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(maxIncomingBitrate);
    } catch (error) {
      console.error(error);
    }
  }

  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    },
  };
}

async function createConsumer(producer: Producer, rtpCapabilities: any): Promise<any> {
  if (!mediasoupRouter.canConsume({
    producerId: producer.id,
    rtpCapabilities,
  })) {
    console.error('can not consume');
    return;
  }

  try {
    consumer = await consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true,
    });
  } catch (error) {
    console.error('consume failed', error);
    return;
  }

  return {
    producerId: producer.id,
    id: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    type: consumer.type,
    producerPaused: consumer.producerPaused
  };
}
