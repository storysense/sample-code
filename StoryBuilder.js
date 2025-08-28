import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en.json';
import { v4 as uuidv4 } from 'uuid';
import MuiAlert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useLocation, useSearchParams, useBlocker } from 'react-router-dom';
import {
  Box,
  CircularProgress,
  Typography,
  Modal,
  Divider,
  TextField,
  IconButton,
} from '@mui/material';
import {
  doc,
  collection,
  addDoc,
  setDoc,
  serverTimestamp,
  deleteDoc,
  query,
  getDocs,
} from 'firebase/firestore';
import { CSS } from '@dnd-kit/utilities';

import { useStorySense } from '../../context/StorySenseProvider';
import { useUser } from '../../context/UserProvider';
import SelectSpeakerModal from '../../components/SelectSpeakerModal/SelectSpeakerModal';
import EditSpeakerModal from '../../components/EditSpeakerModal/EditSpeakerModal';
import { db, PROJECTS_COLLECTION_NAME } from '../../../firebase-config';
import {
  DragOverlayTranscript,
  TranscriptContent,
} from './TranscriptDragAndDrop/TranscriptDragAndDrop';
import {
  DroppableStoryComponent,
  DragOverlayStory,
} from './StoryDragAndDrop/StoryDragAndDrop';
import StoryBuilderHome from './StoryBuilderHome';
import TranscriptsHome from './TranscriptsHome';
import SelectedStory from './SelectedStory';
import StoryBuilderDrawer from './StoryBuilderDrawer';
import { FilterProvider } from '../../context/FilterProvider';
import Logger from '../../util/logger';
import { exportStory } from './exports';
import DeleteConfirmationModal from '../../components/UI/Dialog/DeleteConfirmationModal';
import { useTranscriptList } from '../../hooks/transcripts/useTranscriptList';
import { useTranscript } from '../../hooks/transcripts/useTranscript';
import { useTranscriptsSummaries } from '../../hooks/transcripts/useTranscriptsSummaries';
import StoryBuilderAudioPlayer from './audioManager/StoryBuilderAudioPlayer';
import AudioManager from './audioManager/audioManager';
import { useDebounce } from './hooks/useDebounce';
import { deepSanitizeStoryRow, getBaseAudioUrl } from './utils';

import 'react-h5-audio-player/lib/styles.css';
import './StoryBuilderNavigation.css';
import './StoryBuilder.css';

TimeAgo.addLocale(en);
const colors = [
  '#239ebc',
  '#8f2d56',
  '#ffad49',
  '#8ecae6',
  '#eedc3f',
  '#4660d6',
  '#d81258',
  '#fc8500',
  '#008080',
  '#e6beff',
  '#9a6324',
  '#fffac8',
  '#800000',
  '#aaffc3',
  '#808000',
  '#ffd8b1',
  '#000075',
  '#808080',
  '#ffffff',
  '#000000',
];

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

function StoryBuilderInner() {
  const {
    currentProjectId,
    selectedStory,
    setSelectedStory,
    selectedTranscriptId,
    setSelectedTranscriptId,
    showSearch,
    setShowSearch,
    setStoryRows,
  } = useStorySense();
  const { currentUser } = useUser();
  const location = useLocation();

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return selectedStory && currentLocation.pathname !== nextLocation.pathname;
  });
  const [saveBeforeAppExit, setSaveBeforeAppExit] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchText, setSearchText] = useState('');

  const [storyIsLoading, setStoryIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({
    show: false,
    message: '',
    type: 'success',
  });
  const [currentHighlightIndex, setCurrentHighlightIndex] = useState(0);
  const searchInputRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const highlightRefs = useRef([]);
  const transcriptRowsRef = useRef([]);
  const [searchMatchesCount, setSearchMatchesCount] = useState(0);
  const [deleteStoryModalOpen, setDeleteStoryModalOpen] = useState(false);
  const [deleteTranscriptModalOpen, setDeleteTranscriptModalOpen] =
    useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [speakers, setSpeakers] = useState({});

  const [draggedItemID, setDraggedItemID] = useState(null);
  const [draggedItemData, setDraggedItemData] = useState(null);

  const [targetSpeakerId, setTargetSpeakerId] = useState('');
  const [selectSpeakerModalOpen, setSelectSpeakerModalOpen] = useState(false);
  const [editSpeakerModalOpen, setEditSpeakerModalOpen] = useState(false);
  const [newCharacter, setNewCharacter] = useState(null);
  const [characterSaving, setCharacterSaving] = useState(false);

  const [storiesDrawerOpen, setStoriesDrawerOpen] = useState(false);
  const [transcriptsDrawerOpen, setTranscriptsDrawerOpen] = useState(false);
  const [newStoryInitiated, setNewStoryInitiated] = useState(false);

  const [playingSegment, setPlayingSegment] = useState(null);
  const [currentPlayingType, setCurrentPlayingType] = useState(null);

  const [newTranscriptSpeakerName, setNewTranscriptSpeakerName] = useState('');

  const [selectedTranscript, { isLoading: transcriptIsLoading }] =
    useTranscript(selectedTranscriptId);
  const [selectedStoryRowIds, setSelectedStoryRowIds] = useState([]);
  const { deleteTranscript: deleteTranscriptMutation } = useTranscriptList();
  // just trigger fetching summaries
  useTranscriptsSummaries();

  useEffect(() => {
    setTranscriptsDrawerOpen(false);
  }, [selectedTranscriptId]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    // Note: KeyboardSensor is not included here
  );

  // TODO @see https://storysense.atlassian.net/browse/KAN-304
  // === ADDED FOR TAGGING ===
  // useAutoTagTranscript(transcriptId);

  const handleDragStart = useCallback(
    (event) => {
      const { active } = event;
      if (draggedItemID !== active.id) {
        setDraggedItemID(active.id);

        if (active.id.includes('story-')) {
          const itemData = selectedStory.storyRows.find(
            (row) => row.id === active.id,
          );
          setDraggedItemData(itemData);
        } else {
          const itemData = selectedTranscript.storyRows.find(
            (row) => row.objectID === active.id,
          );
          setDraggedItemData(itemData);
        }
      }
    },
    [draggedItemID, selectedStory?.storyRows, selectedTranscript?.storyRows],
  );

  const handleDragEnd = useCallback(
    (event) => {
      const { active, over } = event;

      if (!over) return; // Exit if not dropped over a valid target

      const fromTranscript = !active.id.includes('story-');
      const toIndex = selectedStory.storyRows.findIndex(
        (row) => row.id === over.id,
      );

      // Handling dragging from transcripts to story column
      if (fromTranscript) {
        if (
          !over.id?.startsWith('story-') &&
          over.id !== 'droppable-story-col'
        ) {
          setDraggedItemID(null);
          setDraggedItemData(null);
          return;
        }
        const itemsToDrop = selectedStoryRowIds.includes(active.id)
          ? selectedStoryRowIds
          : [active.id];

        let newStoryRows = [];

        const draggedItems = selectedTranscript.storyRows?.forEach((row) => {
          if (row && itemsToDrop.includes(row.objectID)) {
            newStoryRows.push({
              ...row,
              id: `story-${uuidv4()}`,
              transcriptId: row.transcriptId || selectedTranscript.id,
              audioUrl: row.audioUrl || selectedTranscript.audioUrl,
            });
          }
        });
        console.log({ newStoryRows });
        setSelectedStory((prevState) => {
          const updatedStoryRows = [...prevState.storyRows];
          updatedStoryRows.splice(
            toIndex < 0 ? updatedStoryRows.length : toIndex,
            0,
            ...newStoryRows,
          );

          return { ...prevState, storyRows: updatedStoryRows };
        });

        setSelectedStoryRowIds([]);
      } else {
        // Handling rearranging within the story column
        const fromIndex = selectedStory.storyRows.findIndex(
          (row) => row.id === active.id,
        );
        if (fromIndex !== -1 && toIndex !== -1) {
          setSelectedStory((prevState) => {
            const updatedStoryRows = [...prevState.storyRows];
            const [rearrangedItem] = updatedStoryRows.splice(fromIndex, 1);
            updatedStoryRows.splice(toIndex, 0, rearrangedItem);
            return { ...prevState, storyRows: updatedStoryRows };
          });
        }
      }

      setDraggedItemID(null);
      setDraggedItemData(null);
    },
    [selectedStory, selectedTranscript],
  );

  const deleteFromStory = useCallback(
    (id) => {
      const updatedStoryRows = selectedStory.storyRows.filter(
        (row) => row.id !== id,
      );
      setSelectedStory({ ...selectedStory, storyRows: updatedStoryRows });
    },
    [selectedStory],
  );

  const editSpeaker = () => {};

  const cycleHighlights = (direction) => {
    // Assuming searchMatchesCount is the state set by setSearchMatchesCount
    if (searchMatchesCount === 0) return;

    let newIndex = currentHighlightIndex + direction;
    if (newIndex >= searchMatchesCount) {
      newIndex = 0; // Loop back to the start
    } else if (newIndex < 0) {
      newIndex = searchMatchesCount - 1; // Loop to the end
    }

    setCurrentHighlightIndex(newIndex);

    // Access and use the ref
    const currentRef = highlightRefs.current[newIndex];
    if (currentRef) {
      currentRef.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
  };

  const goToTranscriptTime = (transcript, startTime, endTime) => {
    setTimeout(() => {
      const currentHighlightIndex = transcript.storyRows.findIndex(
        (row) =>
          row.startTime === startTime &&
          (endTime ? row.endTime === endTime : true),
      );
      if (currentHighlightIndex === -1) return;

      const currentRef = transcriptRowsRef.current[currentHighlightIndex];
      if (currentRef) {
        currentRef.scrollIntoView({ behavior: 'smooth', block: 'center' });
        currentRef.classList.add('highlighted-block');
        // Remove the highlight after 3 seconds
        setTimeout(() => {
          currentRef.classList.remove('highlighted-block');
          // clear search params
          setSearchParams((prevParams) => {
            const newParams = new URLSearchParams(prevParams);
            newParams.delete('startTime');
            newParams.delete('endTime');
            return newParams;
          });
        }, 3000);
      }
    }, 700);
  };

  const handleSaveEdit = useCallback(
    async (showToast = true) => {
      if (!currentProjectId) return;
      setSaving(true);

      const editData = selectedStory;

      // Existing story: Update it
      const storyRef = doc(
        db,
        `${PROJECTS_COLLECTION_NAME}/${currentProjectId}/stories`,
        editData.id,
      );

      const sanitizedStoryRows = editData.storyRows.map((row) =>
        deepSanitizeStoryRow(row),
      );
      const updatedEditData = {
        storyRows: sanitizedStoryRows || [],
        name: editData.name,
        updatedAt: serverTimestamp(),
      };
      try {
        Logger.debug('Saving story board changes', {
          userId: currentUser.uid,
          storyId: editData.id,
          storyName: editData.name,
        });
        await setDoc(storyRef, updatedEditData, { merge: true });

        setStoryRows(
          editData.storyRows.map((row) => deepSanitizeStoryRow(row)) || [],
          true,
        );

        if (showToast) {
          setToast({
            show: true,
            message: 'Story Saved',
            type: 'success',
          });
        }
      } catch (error) {
        setToast({
          show: true,
          message: 'Error: Story was not saved',
          type: 'error',
        });
        Logger.error('Error updating the story: ', {
          error: error.message || 'Unknown error',
          userId: currentUser.uid,
          storyData: editData,
        });
      } finally {
        setSaving(false);
      }

      // Update local state after successful save/update
      setSelectedStory({
        ...editData,
        updatedAt: new Date(),
      });
    },
    [currentProjectId, selectedStory],
  );

  useEffect(() => {
    const getQueryParams = (query) => {
      return new URLSearchParams(query);
    };

    const queryParams = getQueryParams(location.search);
    const startTime = queryParams.get('startTime');
    const endTime = queryParams.get('endTime');
    if (selectedTranscript && startTime) {
      goToTranscriptTime(selectedTranscript, startTime, endTime);
    }
  }, [selectedTranscript, location.search]);

  useEffect(() => {
    const handleKeyDown = async (event) => {
      // Save story on Ctrl+S or Cmd+S
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (selectedStory) {
          try {
            await handleSaveEdit();
          } catch (error) {
            console.error('Error saving story:', error);
          }
        }
      }

      // Show search input on Ctrl+F or Cmd+F
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        setShowSearch(true);
        console.log('Show search input:', searchInputRef.current);
        if (searchInputRef.current) {
          searchInputRef.current.querySelector('input').value = '';
          setSearchText('');
          searchInputRef.current.focus();
        }
      }

      // Hide search input and clear search text on ESC
      if (event.key === 'Escape') {
        setShowSearch(false);
        setSearchText('');
      }

      if (showSearch && event.key === 'Enter') {
        event.preventDefault();
        cycleHighlights(event.shiftKey ? -1 : 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSearch, currentHighlightIndex, selectedStory]);

  useEffect(() => {
    // Function to get query parameters from URL
    const getQueryParams = (query) => {
      return new URLSearchParams(query);
    };

    const queryParams = getQueryParams(location.search);
    const transcriptJobName = queryParams.get('transcript');

    // const startTime = queryParams.get('startTime');
    // const endTime = queryParams.get('endTime');
    if (transcriptJobName) {
      //   loadTranscript(jobName, startTime, endTime);
      setSelectedTranscriptId(transcriptJobName);
    }
  }, [location]);

  useEffect(() => {
    if (blocker.state === 'blocked' && selectedStory) {
      handleSaveEdit()
        .then(() => blocker.proceed())
        .catch(() => {
          blocker.reset();
        });
    } else {
      blocker?.proceed?.();
    }
  }, [blocker, blocker.state, handleSaveEdit, selectedStory]);

  useEffect(() => {
    if (searchParams.has('modal_open')) {
      setNewStoryInitiated(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!currentProjectId || !selectSpeakerModalOpen) return;

    const fetchCharacters = async (projectId) => {
      const charactersObj = {};

      try {
        const q = query(
          collection(db, `${PROJECTS_COLLECTION_NAME}/${projectId}/speakers`),
        );
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          charactersObj[doc.id] = { ...data };
        });
        return charactersObj;
      } catch (err) {
        Logger.error('Error fetching characters from Firestore:', {
          error: err.message || 'Unknown error',
          userId: currentUser.uid,
        });

        throw err;
      }
    };

    fetchCharacters(currentProjectId)
      .then((charactersObj) => setSpeakers(charactersObj))
      .catch((error) => console.log(error));
  }, [currentProjectId, currentUser.uid, selectSpeakerModalOpen]);

  const createNewStory = useCallback(
    async (storyName) => {
      if (!currentProjectId) return;

      setSaving(true);

      const storiesCollectionRef = collection(
        db,
        `${PROJECTS_COLLECTION_NAME}/${currentProjectId}/stories`,
      );

      let docRef;

      try {
        docRef = await addDoc(storiesCollectionRef, {
          name: storyName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          storyRows: [],
        });
        Logger.debug('Creating new story', {
          userId: currentUser.uid,
          storyName,
        });
      } catch (error) {
        Logger.error('Failed to create story', {
          error: error.message || 'Unknown error',
          userId: currentUser.uid,
          storyName,
        });
        setToast({
          show: true,
          message: 'Error: Story could not be created',
          type: 'error',
        });
      } finally {
        setSaving(false);
      }

      setSelectedStory({
        id: docRef.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        name: storyName,
        storyRows: [],
      });
    },
    [currentProjectId, currentUser?.uid, setSelectedStory],
  );

  const onDuplicateStory = useCallback(
    async (oldStory, newName) => {
      if (!currentProjectId) return;

      setSaving(true);

      const storiesCollectionRef = collection(
        db,
        `${PROJECTS_COLLECTION_NAME}/${currentProjectId}/stories`,
      );

      let docRef;

      try {
        docRef = await addDoc(storiesCollectionRef, {
          name: newName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          storyRows: oldStory.storyRows,
          collectionId: oldStory.collectionId || '',
        });
        Logger.debug('Duplicating story', {
          userId: currentUser.uid,
          storyName: newName,
        });
      } catch (error) {
        Logger.error('Failed to duplicate story', {
          error: error.message || 'Unknown error',
          userId: currentUser.uid,
          storyName: newName,
        });
        setToast({
          show: true,
          message: 'Error: Story could not be duplicated',
          type: 'error',
        });
      } finally {
        setSaving(false);
      }

      setSelectedStory({
        id: docRef.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        name: newName,
        storyRows: oldStory.storyRows,
        collectionId: oldStory.collectionId || '',
      });
    },
    [currentProjectId, currentUser?.uid, setSelectedStory],
  );

  const updateStoryName = useCallback(
    async (storyId, storyName) => {
      if (!currentProjectId) return;

      setSaving(true);

      const storyRef = doc(
        db,
        `${PROJECTS_COLLECTION_NAME}/${currentProjectId}/stories`,
        storyId,
      );

      try {
        await setDoc(storyRef, { name: storyName }, { merge: true });

        if (selectedStory && storyId === selectedStory.id) {
          setSelectedStory((prevState) => ({
            ...prevState,
            name: storyName,
          }));
        }
      } catch (error) {
        Logger.error('Failed to update story name', {
          error: error.message || 'Unknown error',
          storyId,
        });
        setToast({
          show: true,
          message: 'Error: Story name could not be updated',
          type: 'error',
        });
      } finally {
        setSaving(false);
      }
    },
    [currentProjectId, selectedStory, setSelectedStory],
  );

  const handleCloseToast = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }
    setToast({ show: false, message: toast.message, type: toast.type });
  };

  const loadStory = async (storyData) => {
    setStoryIsLoading(true);
    try {
      // save current story first
      if (selectedStory) {
        await handleSaveEdit(false);
      }

      setSelectedStory({
        ...storyData,
        audioUrl: getBaseAudioUrl(storyData.storyRows?.[0]?.MediaFileUri),
      });
    } catch (error) {
      Logger.error('Error loading story', {
        error: error.message || 'Unknown error',
        userId: currentUser.uid,
        storyData,
      });
    } finally {
      setStoryIsLoading(false);
      setStoriesDrawerOpen(false);
    }
  };

  const calculateMatches = (rowText, searchString) => {
    if (!searchString) return 0;
    const regex = new RegExp(searchString, 'gi');
    return (rowText.match(regex) || []).length;
  };

  // Debounce the search handler with a 300ms delay
  const debouncedHandleSearchChange = useDebounce((newSearchText) => {
    setSearchText(newSearchText);
    // Calculate total matches
    let totalMatches = 0;
    if (selectedTranscript && selectedTranscript.storyRows) {
      selectedTranscript.storyRows.forEach((row) => {
        totalMatches += calculateMatches(row.content, newSearchText);
      });
    }

    setSearchMatchesCount(totalMatches);
    setCurrentHighlightIndex(0); // Reset to the first match
  }, 300);

  const handleSearchChange = (e) => {
    const newSearchText = e.target.value;
    debouncedHandleSearchChange(newSearchText);
  };

  const askToDeleteStory = async (story) => {
    setDeleteStoryModalOpen(true);
    setPendingDelete(story);
  };

  const askToDeleteTranscript = async (transcript) => {
    setDeleteTranscriptModalOpen(true);
    setPendingDelete(transcript);
  };

  const cancelDelete = () => {
    setDeleteStoryModalOpen(false);
    setDeleteTranscriptModalOpen(false);
    setPendingDelete(null);
  };

  const deleteStory = useCallback(
    async (story) => {
      if (!currentProjectId) return;

      const storyRef = doc(
        db,
        `${PROJECTS_COLLECTION_NAME}/${currentProjectId}/stories`,
        story.id,
      );

      setIsDeleting(true);

      try {
        await deleteDoc(storyRef);
        setToast({
          show: true,
          message: 'Story deleted successfully',
          type: 'success',
        });
      } catch (error) {
        Logger.error('Error deleting the story: ', {
          error: error.message || 'Unknown error',
          userId: currentUser.uid,
          storyData: story,
        });

        setToast({
          show: true,
          message: 'Error: Deleting the story failed',
          type: 'error',
        });
      } finally {
        setIsDeleting(false);
        setDeleteStoryModalOpen(false);
        setPendingDelete(null);
        setSelectedStory(null);
      }
    },
    [currentProjectId, currentUser?.uid, setSelectedStory],
  );

  const deleteTranscript = useCallback(
    async (transcript) => {
      setIsDeleting(true);
      try {
        if (selectedTranscriptId === transcript.id) {
          setSelectedTranscriptId(null);
        }
        await deleteTranscriptMutation.mutateAsync(transcript.id);
        setToast({
          show: true,
          message: 'Transcript deleted successfully',
          type: 'success',
        });
      } catch (error) {
        setToast({
          show: true,
          message: 'Error: Deleting the transcript failed',
          type: 'error',
        });
        Logger.error('Error deleting transcript:', {
          error: error.message || 'Unknown error',
          userId: currentUser?.uid,
          transcriptId: transcript.id,
        });
      } finally {
        setIsDeleting(false);
        setDeleteTranscriptModalOpen(false);
        setPendingDelete(null);
      }
    },
    [
      currentUser?.uid,
      deleteTranscriptMutation,
      selectedTranscriptId,
      setSelectedTranscriptId,
    ],
  );

  const [audioManager, setAudioManager] = useState(null);

  useEffect(() => {
    if (audioPlayerRef.current?.audio?.current) {
      setAudioManager(new AudioManager(audioPlayerRef.current.audio.current));
    }
  }, [audioPlayerRef.current]);

  const flatMappedStoryRows = selectedStory?.storyRows
    ?.map((row) => {
      if (row.type === 'synthetic') {
        return row.children
          .map((child) =>
            child.type === 'frank'
              ? child.children.map((frankItem) => frankItem)
              : child,
          )
          .flatMap((item) => item);
      }

      return row;
    })
    .flatMap((row) => row);

  const playAudio = async (segment, type, currentIndex) => {
    if (!audioManager) return;
    const storyRowsList = flatMappedStoryRows || selectedStory?.storyRows;

    try {
      await audioManager.playSegment(segment, type, {
        playingSegment,
        setPlayingSegment,
        setPlayingType: setCurrentPlayingType,
        onSegmentEnd: () => {
          // Auto-play next segment if available
          if (type === 'story' && storyRowsList) {
            const mappedStoryIndex = storyRowsList.findIndex((row, i) => {
              // for the case of frank rows that come from the same transcript (meaning same transcript id) - without this we'll have an infinite loop
              if (row.storyRowEdits?.length > 0) {
                return (
                  row.id === segment.id &&
                  row.storyRowEdits[0].inPoint ===
                    storyRowsList[currentIndex].storyRowEdits?.[0]?.inPoint
                );
              }

              return row.id === segment.id;
            });
            const nextIndex = mappedStoryIndex + 1;

            if (nextIndex < storyRowsList.length) {
              const nextRow = storyRowsList[nextIndex];
              playAudio(
                {
                  id: nextRow.id,
                  startTime: nextRow.startTime,
                  endTime: nextRow.endTime,
                  audioUrl: nextRow.audioUrl || nextRow.MediaFileUri,
                  storyRowEdits: nextRow.storyRowEdits,
                },
                type,
                nextIndex,
              );
            }
          } else if (type === 'transcript' && selectedTranscript?.storyRows) {
            const nextIndex = currentIndex + 1;
            if (nextIndex < selectedTranscript.storyRows.length) {
              const nextRow = selectedTranscript.storyRows[nextIndex];
              playAudio(
                {
                  id: nextRow.objectID,
                  startTime: nextRow.startTime,
                  endTime: nextRow.endTime,
                  audioUrl: nextRow.audioUrl || selectedTranscript.audioUrl,
                },
                type,
                nextIndex,
              );
            }
          }
        },
      });
    } catch (error) {
      console.error('Failed to play audio:', error);
      setToast({
        show: true,
        message: 'Error playing audio',
        type: 'error',
      });
    }
  };

  const handleExportStory = useCallback(
    (exportTo) => exportStory(selectedStory, exportTo),
    [selectedStory],
  );

  const audioUrl =
    selectedTranscript?.audioUrl ||
    selectedStory?.audioUrl ||
    selectedStory?.MediaFileUri;

  const audioTitle =
    selectedTranscript?.sequenceName ||
    selectedStory?.name ||
    selectedTranscript?.FileName;

  useEffect(() => {
    const handleAppClosing = async () => {
      if (selectedStory) {
        try {
          setSaveBeforeAppExit(true);
          await handleSaveEdit(false); // Save the story without showing a toast
        } catch (error) {
          console.error('Error saving story before close:', error);
        } finally {
          setSaveBeforeAppExit(false);
          window.electron.ipcRenderer.sendMessage('app-can-close');
        }
      } else {
        window.electron.ipcRenderer.sendMessage('app-can-close');
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on(
      'app-closing',
      handleAppClosing,
    );

    return () => {
      unsubscribe();
    };
  }, [selectedStory, handleSaveEdit]);

  useEffect(() => {
    setSearchText('');
  }, [showSearch]);

  // const combinedCollisionDetection = (args) => {
  //   const { active } = args;
  //   console.log({ active });
  //   if (!active?.id?.startsWith('story-')) {
  //     const pointer = pointerWithin(args);
  //     if (pointer.length > 0) return pointer;

  //     // return rectIntersection(args);

  //     // if using closest center, only return the 'droppable-story-col'
  //     const closest = closestCenter(args);
  //     const droppableStoryCol = closest.filter(
  //       (item) => !item.id?.startsWith('story-'),
  //     );

  //     if (droppableStoryCol?.length) {
  //       return droppableStoryCol;
  //     }

  //     return closest;
  //   }

  return (
    <div>
      <SelectSpeakerModal
        open={selectSpeakerModalOpen}
        charactersList={Object.values(speakers).filter(
          (s) => s.type === 'main',
        )}
        targetSpeakerId={targetSpeakerId}
        onCancel={() => {
          setSelectSpeakerModalOpen(false);
          setTargetSpeakerId(null);
        }}
        onAdd={(newSpeakerName = '') => {
          setNewTranscriptSpeakerName(newSpeakerName);
          setSelectSpeakerModalOpen(false);
          setEditSpeakerModalOpen(true);
        }}
      />

      <EditSpeakerModal
        setIsSaving={setCharacterSaving}
        open={editSpeakerModalOpen}
        speakerData={newCharacter}
        newSpeakerName={newTranscriptSpeakerName}
        targetSpeakerId={targetSpeakerId}
        onClose={() => {
          setEditSpeakerModalOpen(false);
        }}
        onUpdateSpeakerImage={() => {}}
      />

      <Box
        className="floating-search-container"
        sx={{
          display: showSearch ? 'flex' : 'none',
          alignItems: 'center',
          gap: 1,
          position: 'fixed',
          top: 70,
          left: 0,
          right: '-50%',
          width: '100%',
          maxWidth: searchText ? 400 : 250,
          transition: 'width 0.3s',
          zIndex: 1,
          margin: 'auto',
          padding: 1,
          backdropFilter: 'blur(10px)',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'custom.gray',
          boxShadow: 5,
        }}
      >
        <TextField
          placeholder="Search this transcript"
          onChange={handleSearchChange}
          ref={searchInputRef}
          variant="outlined"
          size="small"
          autoFocus
          sx={{ flexGrow: 1 }}
        />

        {searchText && (
          <Typography variant="caption" sx={{ mr: 1 }}>
            {searchMatchesCount === 0 ? 0 : currentHighlightIndex + 1}/
            {searchMatchesCount}
          </Typography>
        )}

        {searchText && <Divider orientation="vertical" flexItem />}

        <Box display="flex" sx={{ gap: 0.2 }}>
          {searchText ? (
            <>
              <IconButton
                size="small"
                onClick={() => cycleHighlights(-1)}
                disabled={searchMatchesCount < 2}
                sx={{ borderRadius: 1 }}
              >
                <KeyboardArrowUpIcon />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => cycleHighlights(1)}
                disabled={searchMatchesCount < 2}
                sx={{ borderRadius: 1 }}
              >
                <KeyboardArrowDownIcon />
              </IconButton>
            </>
          ) : null}
          <IconButton
            size="small"
            onClick={() => {
              setSearchText('');
              setShowSearch(false);
            }}
            sx={{
              height: 24,
              width: 24,
              my: 'auto',
            }}
          >
            <CloseRoundedIcon fontSize="12" />
          </IconButton>
        </Box>
      </Box>

      <Modal open={blocker.state === 'blocked' || saveBeforeAppExit}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}
        >
          <Typography variant="h4">Saving...</Typography>
        </div>
      </Modal>

      <StoryBuilderDrawer
        loadStory={loadStory}
        storiesDrawerOpen={storiesDrawerOpen}
        setStoriesDrawerOpen={setStoriesDrawerOpen}
        onNewStory={createNewStory}
        onDuplicateStory={onDuplicateStory}
        newStoryInitiated={newStoryInitiated}
        onNewStoryInitiationComplete={() => setNewStoryInitiated(false)}
        onDeleteStory={askToDeleteStory}
        updateStoryName={updateStoryName}
        transcriptsDrawerOpen={transcriptsDrawerOpen}
        setTranscriptsDrawerOpen={setTranscriptsDrawerOpen}
        onNewTranscript={() => {}}
        onDeleteTranscript={askToDeleteTranscript}
        deleteStoryModalOpen={deleteStoryModalOpen}
        isSavingStory={saving}
        beforeProjectChange={(changeProjectFn) => {
          if (selectedStory)
            handleSaveEdit(false)
              .then(changeProjectFn)
              .catch((error) => console.log('Error changing project', error));
        }}
        deleteTranscriptModalOpen={deleteTranscriptModalOpen}
      >
        <Box
          sx={{
            height: 'inherit',
            padding: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 2,
              flexGrow: 1,
              overflowY: 'hidden',

              '& > div': {
                height: '100%',
                overflowY: 'hidden',
              },
            }}
          >
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              collisionDetection={pointerWithin}
              // collisionDetection={combinedCollisionDetection}
            >
              <DroppableStoryComponent id="droppable-story-col">
                <Box
                  sx={{
                    border: '1px solid',
                    borderColor: 'custom.gray',
                    backgroundColor:
                      !storyIsLoading && selectedStory
                        ? 'background.paper'
                        : 'transparent',
                    borderRadius: 2,
                    width: '100%',
                    pt: 1,
                    pb: 2,
                    height: 'inherit',
                  }}
                >
                  {!selectedStory && !storyIsLoading && (
                    <StoryBuilderHome
                      onNewStory={() => setNewStoryInitiated(true)}
                      onLoadStory={() => setStoriesDrawerOpen(true)}
                    />
                  )}

                  {!selectedStory && storyIsLoading && (
                    <Box
                      sx={{
                        display: 'grid',
                        placeItems: 'center',
                        height: '100%',
                        borderRadius: 2,
                      }}
                    >
                      <CircularProgress />
                    </Box>
                  )}

                  {selectedStory && (
                    <SelectedStory
                      selectedStory={selectedStory}
                      isSaving={saving}
                      updateStoryName={updateStoryName}
                      handleSaveEdit={handleSaveEdit}
                      draggedItemID={draggedItemID}
                      speakers={speakers}
                      editSpeaker={editSpeaker}
                      deleteFromStory={deleteFromStory}
                      handleExportStory={handleExportStory}
                      playingSegment={playingSegment}
                      currentPlayingType={currentPlayingType}
                      playAudio={playAudio}
                      audioManager={audioManager}
                      setToast={setToast}
                    />
                  )}
                </Box>
              </DroppableStoryComponent>

              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'custom.gray',
                  backgroundColor:
                    !transcriptIsLoading &&
                    selectedTranscript &&
                    selectedTranscript.FileName
                      ? 'background.paper'
                      : 'transparent',
                  borderRadius: 2,
                  pt: 1,
                  pb: 2,
                  height: '100%',
                  overflowY: 'hidden',
                }}
              >
                {!selectedTranscript && !transcriptIsLoading && (
                  <TranscriptsHome
                    onLoadTranscript={() => setTranscriptsDrawerOpen(true)}
                  />
                )}

                {!selectedTranscript && transcriptIsLoading && (
                  <Box
                    sx={{
                      display: 'grid',
                      placeItems: 'center',
                      height: '100%',
                      borderRadius: 2,
                    }}
                  >
                    <CircularProgress />
                  </Box>
                )}

                {!transcriptIsLoading && selectedTranscript && (
                  <TranscriptContent
                    draggedItemID={draggedItemID}
                    highlightRefs={highlightRefs}
                    searchText={searchText}
                    playAudio={playAudio}
                    transcriptRowsRef={transcriptRowsRef}
                    currentHighlightIndex={currentHighlightIndex}
                    isDraggableEnabled={!!selectedStory}
                    onClickSpeaker={(id) => {
                      setTargetSpeakerId(id);
                      setSelectSpeakerModalOpen(true);
                    }}
                    playingSegment={playingSegment}
                    currentPlayingType={currentPlayingType}
                    selectedStoryRowIds={selectedStoryRowIds}
                    setSelectedStoryRowIds={setSelectedStoryRowIds}
                  />
                )}
              </Box>

              {draggedItemData && (
                <DragOverlay style={{ height: '80vh' }}>
                  {draggedItemID.includes('story-') ? (
                    <DragOverlayStory
                      draggedItemID={draggedItemID}
                      selectedStory={selectedStory}
                      speakers={speakers}
                      storyData={draggedItemData}
                    />
                  ) : (
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        height: 'fit-content',
                        backdropFilter: 'blur(5px)',
                      }}
                    >
                      {(selectedStoryRowIds.includes(draggedItemID)
                        ? selectedStoryRowIds
                        : [draggedItemID]
                      ).map((id) => (
                        <>
                          <DragOverlayTranscript
                            key={id}
                            draggedItemID={id}
                            draggedItemData={
                              selectedTranscript.storyRows.find(
                                (row) => row.objectID === id,
                              ) || {}
                            }
                            playingSegment={playingSegment}
                            currentPlayingType={currentPlayingType}
                          />
                        </>
                      ))}
                    </Box>
                  )}
                </DragOverlay>
              )}
            </DndContext>
          </Box>

          {audioUrl && (
            <StoryBuilderAudioPlayer
              audioPlayerRef={audioPlayerRef}
              audioTitle={audioTitle}
              audioUrl={audioUrl}
            />
          )}
        </Box>
      </StoryBuilderDrawer>

      <DeleteConfirmationModal
        isOpen={deleteStoryModalOpen}
        onClose={() => setDeleteStoryModalOpen(false)}
        onDelete={() => deleteStory(pendingDelete)}
        onCancel={cancelDelete}
        title="Delete Story"
        message="Are you sure you want to delete this story?"
        itemName={pendingDelete?.name}
        isLoading={isDeleting}
      />

      <DeleteConfirmationModal
        isOpen={deleteTranscriptModalOpen}
        onClose={() => setDeleteTranscriptModalOpen(false)}
        onDelete={() => deleteTranscript(pendingDelete)}
        onCancel={cancelDelete}
        title="Delete Transcript"
        message="Are you sure you want to delete this transcript?"
        itemName={pendingDelete?.name}
        isLoading={isDeleting}
      />

      <Snackbar
        sx={{
          bottom: { xs: '60px', sm: '60px' },
        }}
        open={toast.show}
        autoHideDuration={1500}
        onClose={handleCloseToast}
      >
        <Alert
          onClose={handleCloseToast}
          severity={toast.type}
          sx={{ width: '100%' }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </div>
  );
}

function StoryBuilder() {
  return (
    <FilterProvider>
      <StoryBuilderInner />
    </FilterProvider>
  );
}

export default StoryBuilder;
