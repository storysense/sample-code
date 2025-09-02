const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const { v4: uuidv4 } = require('uuid');
const algoliasearch = require('algoliasearch');
const admin = require('firebase-admin');
const serviceAccount = require('./storysense-ai-firebase-adminsdk-fsufe-a2225b411b.json');
const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAIEmbeddings } = require("@langchain/openai");
const { PineconeStore } = require("@langchain/pinecone");
const { Document } = require("@langchain/core/documents");

const TRANSCRIPTS_INDEXNAME = "transcripts";
const SPEAKERS_INDEXNAME = "speakers";
const PROJECT_COLLECTION_NAME = "projects";

const MIN_WORD_COUNT = 3;
const MAX_WORD_COUNT = 100;



admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firestore = admin.firestore();
const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

const formatTime = (seconds) => {
  const date = new Date(0);
  date.setSeconds(seconds);
  const isoString = date.toISOString();
  const hoursMinutesSeconds = isoString.substr(11, 8);
  const milliseconds = Math.round((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${hoursMinutesSeconds}:${milliseconds}`;
};

exports.handler = async (event) => {
  try {

    let tempSegmentText = []; // Temporary storage for segments by the same speaker
    let tempStartTime = null; // Start time for the aggregated segment
    let tempEndTime = null; // End time for the aggregated segment
    let currentSpeaker = null; // Current speaker for the aggregated segment


    console.log("Handling event:", event);
    if (event.test) {
      console.log('OK');
      return;
    }
    const applicationId = process.env.ALGOLIA_APPLICATION_ID;
    const adminApiKey = process.env.ADMIN_API_KEY;
    let updatedStoryRows = [];
    let updatedSpeakers = [];
    const colors = ["#FC8500", "#4660D6", "#D81258", "#239EB", "#8F2D56", "#239ebc", "#8f2d56", "#ffad49", "#8ecae6", "#eedc3f", "#4660d6", "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324", "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1", "#000075", "#808080", "#ffffff", "#000000"];

    const bucketName = event.Records[0].s3.bucket.name;
    console.log("Bucket Name:", bucketName);

    const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    console.log("File Key:", key);
    const keyComponents = key.split('_');
    let userId, transcriptIdWithExtension, projectId;
    if (keyComponents.length === 2) {
      // Legacy support -- when projectId was not included in transcription path
      [userId, transcriptIdWithExtension] = keyComponents;
      projectId = null;
    } else {
      [userId, projectId, transcriptIdWithExtension] = keyComponents;
    }
    const transcriptId = transcriptIdWithExtension.replace('.json', '');
    console.log("Project ID:", projectId);
    console.log("Transcript ID:", transcriptId);
    const outputLocationURI = `https://${bucketName}.s3.amazonaws.com/${key}`;

    const params = {
      Bucket: bucketName,
      Key: key,
    };

    const client = algoliasearch(applicationId, adminApiKey);
    const transcriptIndex = client.initIndex(TRANSCRIPTS_INDEXNAME);
    const speakerIndex = client.initIndex(SPEAKERS_INDEXNAME);
    const pineconeIndex = pc.index("transcripts-dt"); // changed to transcripts-dt

    const s3Response = await s3.getObject(params).promise();
    console.log("S3 Response:", s3Response);

    const transcriptData = JSON.parse(s3Response.Body.toString('utf-8'));
    console.log("Transcript Data:", transcriptData);

    const transcriptFileName = event.Records[0].s3.bucket.name + "/" + event.Records[0].s3.object.key;

    const segments = transcriptData.results.speaker_labels.segments;
    console.log("Segments Array:", segments);

    const completedAtTime = new Date();
    console.log("Completed at time:", completedAtTime);

    const transcriptRef = projectId
      ? firestore.doc(`${PROJECT_COLLECTION_NAME}/${projectId}/transcripts/${transcriptId}`)
      : firestore.doc(`users/${userId}/transcripts/${transcriptId}`);

    const transcriptDoc = await transcriptRef.get();
    const transcriptInfo = transcriptDoc.data();
    const transcribedFromFileName = transcriptInfo.FileName.replace(".mp3", "");
    const transcribedFromMediaFileUri = transcriptInfo.MediaFileUri;
    console.log("TranscribedFromMedia File", transcribedFromMediaFileUri);

    //todo not sure why this is broken
    console.log("transcriptInfo.CreatedAt", transcriptInfo.CreatedAt);
    //const transcribedStartedAt = transcriptInfo.CreatedAt;

    const completedAtDate = new Date();
    const sequenceID = transcriptInfo.sequenceID ? transcriptInfo.sequenceID : null;
    // const sequenceName = transcriptInfo.sequenceName || null;
    //const path = transcriptInfo.path || null;


    segments.forEach(segment => {
      let segmentText = [];

      segment.items.forEach(item => {
        const wordItem = transcriptData.results.items.find(w => w.start_time === item.start_time && w.end_time === item.end_time);
        if (wordItem) {
          segmentText.push({
            content: wordItem.alternatives[0].content,
            confidence: wordItem.alternatives[0].confidence,
            startTime: wordItem.start_time,
            endTime: wordItem.end_time
          });
        }
      });
    
      const segmentWordCount = segmentText.reduce((count, wordObj) => {
        return count + wordObj.content.split(' ').length;
      }, 0);
    
      const currentChunkWordCount = tempSegmentText.reduce((count, wordObj) => {
        return count + wordObj.content.split(' ').length;
      }, 0);
    
      const willExceedChunkLimit = currentChunkWordCount + segmentWordCount > MAX_WORD_COUNT;
    
      if (!currentSpeaker || currentSpeaker.name !== segment.speaker_label || willExceedChunkLimit) {
        if (tempSegmentText.length > 0) {
          updatedStoryRows.push({
            objectID: uuidv4(),
            userID: userId,
            projectID: projectId,
            text: tempSegmentText,
            content: tempSegmentText.map(t => t.content).join(' '),
            textItems: tempSegmentText,
            startTime: tempStartTime,
            endTime: tempEndTime,
            speakerID: currentSpeaker.objectID,
            speakerColor: currentSpeaker.color,
            name: currentSpeaker.name,
            type: 'transcription',
            OutputLocationURI: outputLocationURI,
            Status: "COMPLETED",
            JobName: transcriptId,
            FileName: transcribedFromFileName,
            MediaFileUri: transcribedFromMediaFileUri,
            CompletedAt: completedAtDate,
            sequenceID: sequenceID,
            //sequenceName: sequenceName,
            //path: path,
            ...(transcriptInfo.nodeId && { nodeId: transcriptInfo.nodeId }) // Add nodeId if present.
          });

          updatedStoryRows[updatedStoryRows.length - 1].contentWordCount =
          updatedStoryRows[updatedStoryRows.length - 1].content.trim().split(/\s+/).filter(Boolean).length;
        }

        // Reset temp variables for new chunk
        tempSegmentText = segmentText;
        tempStartTime = formatTime(parseFloat(segment.start_time));
        tempEndTime = formatTime(parseFloat(segment.end_time));
        currentSpeaker = updatedSpeakers.find(s => s.name === segment.speaker_label);

        if (!currentSpeaker) { // NEW: Checking and creating new speaker
          const speaker_id = uuidv4();
          const speaker_color = colors[updatedSpeakers.length % colors.length];
          currentSpeaker = {
            objectID: speaker_id,
            userID: userId,
            projectID: projectId,
            name: segment.speaker_label,
            JobNames: [{ id: transcriptId, filename: transcribedFromFileName, speakerId: speaker_id }],
            color: speaker_color
          };
          updatedSpeakers.push(currentSpeaker);
        }
      } else {
        // Continue aggregating
        tempSegmentText = [...tempSegmentText, ...segmentText];
        tempEndTime = formatTime(parseFloat(segment.end_time));
      }
    });
    
  // NEW: If there are remaining segments that didn't get pushed:
  if (tempSegmentText.length > 0) {
    updatedStoryRows.push({
      objectID: uuidv4(),
      projectID: projectId,
      text: tempSegmentText,
      content: tempSegmentText.map(t => t.content).join(' '),
      textItems: tempSegmentText,
      startTime: tempStartTime,
      endTime: tempEndTime,
      speakerID: currentSpeaker.objectID,
      speakerColor: currentSpeaker.color,
      name: currentSpeaker.name,
      type: 'transcription',
      OutputLocationURI: outputLocationURI,
      Status: "COMPLETED",
      JobName: transcriptId,
      FileName: transcribedFromFileName,
      MediaFileUri: transcribedFromMediaFileUri,
      CompletedAt: completedAtDate,
      sequenceID: sequenceID,
      //sequenceName: sequenceName,
      //path: path,
      ...(transcriptInfo.nodeId && { nodeId: transcriptInfo.nodeId }) // Add nodeId if present.
    });

    updatedStoryRows[updatedStoryRows.length - 1].contentWordCount =
    updatedStoryRows[updatedStoryRows.length - 1].content.trim().split(/\s+/).filter(Boolean).length;

  }
    const batch = firestore.batch();
    let speakerIDs = [];

    updatedSpeakers.forEach(speaker => {
      speakerIDs.push(speaker.objectID);
      const speakerRef = projectId
        ? firestore.doc(`${PROJECT_COLLECTION_NAME}/${projectId}/speakers/${speaker.objectID}`)
        : firestore.doc(`users/${userId}/speakers/${speaker.objectID}`);
      batch.set(speakerRef, speaker);
    });

    await batch.commit();

    await transcriptRef.update({
      Status: "COMPLETED",
      CompletedAt: completedAtTime,
      OutputLocationURI: outputLocationURI,
      indexName: `transcripts`,
      speakerIDs: speakerIDs
    });

    const storyRowsRef = transcriptRef.collection('storyRows');
    const storyRowWrites = updatedStoryRows.map(row => {
      const newRowRef = storyRowsRef.doc(row.objectID);
      return newRowRef.set(row);
    });

    await Promise.all(storyRowWrites);

    const docs = updatedStoryRows.map(row => {

      const doc = new Document({
        pageContent: row.content,
        metadata: {
          objectID: row.objectID,
          speakerID: row.speakerID,
          contentWordCount: row.contentWordCount,
          projectID: row.projectID,
          speakerColor: row.speakerColor,
          name: row.name,
          type: row.type,
          OutputLocationURI: row.OutputLocationURI,
          Status: row.Status,
          JobName: row.JobName,
          FileName: row.FileName,
          MediaFileUri: row.MediaFileUri,
          CompletedAt: row.CompletedAt,
          ...(row.nodeId && { nodeId: row.nodeId }) // ✅ Injects nodeId if present
        },
      });

      console.log("Document Prepared for Pinecone:", doc); // This line logs the document object
      return doc;
    });

    const docIds = updatedStoryRows.map(row => row.objectID);

    const pinecone = await PineconeStore.fromExistingIndex(
      new OpenAIEmbeddings({
        model: 'text-embedding-3-large',
        apiKey: process.env.OPENAI_API_KEY
      }),
      {
        namespace: projectId,
        pineconeConfig: {
          config: {
            apiKey: process.env.PINECONE_API_KEY
          },
          indexName: 'transcripts-dt',         //transcripts dt
          indexHostUrl: process.env.PINECONE_DB_URL,
          namespace: projectId,
        }
      },
    );


    await pinecone.addDocuments( docs, docIds );

    console.log('store complete from pinecone');
    const algoliaSpeakersResponse = await speakerIndex.saveObjects(updatedSpeakers);
    const algoliaSavedResponse = await transcriptIndex.saveObjects(updatedStoryRows);

    const response = {
      statusCode: 200,
      body: JSON.stringify('OK'),
    };


    // ✅ Set a Firestore flag to signal completion
    await transcriptRef.update({
      transcriptionProcessingComplete: true
    });


    return response;

  } catch (e) {
    console.log("Lambda function error: ", e);
    const response = {
      statusCode: 500,
      body: JSON.stringify('ERROR'),
    };
    return response;
  }
};
