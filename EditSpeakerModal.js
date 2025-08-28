import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  InputLabel,
  Modal,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import ChipDelete from '@mui/joy/ChipDelete';
import { HexColorPicker } from 'react-colorful';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import DeleteForever from '@mui/icons-material/DeleteForever';
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import CharacterPhotoUploader from '../CharacterPhotoUploader/CharacterPhotoUploader';
import { createNewSpeaker } from '../../util/api';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, PROJECTS_COLLECTION_NAME } from '../../../firebase-config';
import useCurrentProject from '../../hooks/project/useCurrentProject';
import { TranscriptQueryKey } from '../../hooks/transcripts/utils';
import useTranscriptSpeakerUpdate from '../../hooks/transcripts/useTranscriptSpeakerUpdate';
import { useStorySense } from '../../context/StorySenseProvider';
import { SpeakerQueryKey } from '../../hooks/speakers/util';

const colors = [
  '#FC8500',
  '#4660D6',
  '#D81258',
  '#239EBC',
  '#8F2D56',
  '#8ECAE6',
  '#F28C38',
  '#5A6FCD',
  '#DA5678',
  '#72B2D4',
  '#A76798',
  '#FFC085',
  '#FFB3A1',
  '#4A7A8C',
  '#E38B97',
  '#F6CC8F',
  '#C26A5A',
  '#A4A4A4',
  '#FF8B94',
  '#B6A572',
  '#FFCBA1',
  '#617DA0',
  '#989898',
  '#FFFFFF',
  '#000000',
];

const EditSpeakerModal = ({
  open,
  speakerData,
  onSave,
  onClose,
  onUpdateSpeakerImage,
  isLoading,
  setIsSaving,
  newSpeakerName = '',
  targetSpeakerId = '',
}) => {
  const colorPickerRef = useRef(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [editSpeaker, setEditSpeaker] = useState(null);
  const colorInputRef = useRef(null);
  const { currentProjectId: projectId } = useCurrentProject();
  const { selectedTranscriptId: transcriptId } = useStorySense();
  const [modalIsLoading, setModalIsLoading] = useState(false);
  const { updateTranscriptSpeakers, updateStoriesSpeakers } =
    useTranscriptSpeakerUpdate();

  const queryClient = useQueryClient();

  const updateEditSpeaker = (type, value) => {
    setEditSpeaker((prev) => ({ ...prev, [type]: value }));
  };

  const changeName = (value) => {
    updateEditSpeaker('name', value);
    setNameError(false);
  };

  const validate = () => {
    if (editSpeaker.name === '') {
      setNameError(true);
      return false;
    }

    return true;
  };

  const handleSave = async () => {
    const isValid = validate();

    if (!isValid) return;
    console.log({ editSpeaker });
    setModalIsLoading(true);

    // this is when we are editing/adding a character in characters tab
    if (!newSpeakerName || !targetSpeakerId) {
      onSave?.(editSpeaker);
      setModalIsLoading(false);
      return;
    }

    // when we are assigning a new character to a transcript in story builder page
    setIsSaving(true);
    console.log(`Creating new character named ${editSpeaker.name}`);
    const newSpeaker = await createNewSpeaker(projectId, editSpeaker);
    updateTranscriptSpeakers(targetSpeakerId, newSpeaker, transcriptId);
    updateStoriesSpeakers(targetSpeakerId, newSpeaker);

    // update local speakers cache
    queryClient.setQueryData(
      SpeakerQueryKey(projectId).speakersList,
      (prevSpeakers) => {
        if (!prevSpeakers) return prevSpeakers;

        return [...prevSpeakers, newSpeaker];
      },
    );

    setModalIsLoading(false);
    setIsSaving(false);
    onClose();
  };

  const handleClose = () => {
    setNameError(false);
    onClose();
  };

  const updateEditSpeakerDescription = useCallback((event) => {
    setEditSpeaker((prev) => ({
      ...prev,
      description: event.target.value,
    }));
  }, []);

  const handleUploadComplete = (url) => {
    onUpdateSpeakerImage(editSpeaker.id, url);
    setEditSpeaker((prev) => ({ ...prev, image: url }));
  };

  const handleTypeChange = (event) => {
    const isMain = event.target.checked;

    setEditSpeaker((prev) => ({
      ...prev,
      type: isMain ? 'main' : 'other',
      description: isMain ? prev.description : '',
    }));
  };

  useEffect(() => {
    if (open) {
      if (speakerData) {
        setEditSpeaker({
          ...speakerData,
          description: speakerData.description || '',
        });
      } else {
        setEditSpeaker({
          name: newSpeakerName ?? `New Character`,
          color: colors[Math.floor(Math.random() * colors.length)],
          type: 'main',
          description: '',
          image: null,
          JobNames: [],
          aliases: [],
        });
      }
    } else {
      setEditSpeaker(null);
    }
  }, [open]);

  if (!editSpeaker) return null;

  return (
    <Modal open={open} onClose={handleClose}>
      <Box
        onClick={handleClose}
        sx={{
          height: '100%',
          width: '100%',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Box
          onClick={(e) => {
            e.stopPropagation();
            // if the item clocked is not the color picker, close the color picker
            if (
              colorPickerRef.current &&
              !colorPickerRef.current.contains(e.target) &&
              colorPickerOpen
            ) {
              setColorPickerOpen(false);
            }
          }}
          sx={{
            minWidth: '30%',
            maxHeight: '50%',
            height: 'auto',
            overflowY: 'visible',
            bgcolor: 'background.default',
            borderRadius: 2,
            padding: 2,
            boxShadow: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              margin: 'auto',
              backgroundColor: 'background.default',
              borderRadius: 2,
              p: 2,
              gap: editSpeaker.type === 'main' ? 4 : 0,
            }}
          >
            <Tooltip title="Drag-and-drop image">
              <Box
                sx={{
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'width 0.3s',
                  width: editSpeaker.type === 'main' ? 150 : 0,
                  display: 'grid',
                  justifyContent: 'center',
                  p: editSpeaker.type === 'main' ? 1 : 0,
                  '&:hover': {
                    opacity: 0.7,
                    bgcolor: 'background.paper',
                  },
                }}
              >
                {editSpeaker.type === 'main' && (
                  <>
                    <Avatar
                      src={editSpeaker.image ? editSpeaker.image : null}
                      sx={{
                        width: 140,
                        height: 140,
                        border: '2px solid',
                        borderColor: 'custom.gray',
                      }}
                    />

                    <CharacterPhotoUploader
                      characterId={editSpeaker ? editSpeaker.id : ''}
                      onUploadComplete={handleUploadComplete}
                    />
                  </>
                )}
              </Box>
            </Tooltip>

            <Box
              width={'25rem'}
              flexGrow={1}
              display="flex"
              flexDirection="column"
              gap={2}
            >
              <TextField
                placeholder="Name"
                size="small"
                value={editSpeaker ? editSpeaker.name : ''}
                onChange={(e) => changeName(e.target.value)}
                error={nameError}
                autoFocus
              />

              <Box
                sx={{
                  height: editSpeaker.type === 'main' ? 110 : 0,
                  overflow: 'hidden',
                  transition: 'height 0.3s',
                }}
              >
                {editSpeaker.type === 'main' && (
                  <TextField
                    rows={3}
                    multiline
                    fullWidth
                    placeholder="Add a description about this character"
                    value={editSpeaker ? editSpeaker.description : ''}
                    onChange={updateEditSpeakerDescription}
                  />
                )}
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 2,
                  alignItems: 'start',
                  mt: editSpeaker.type === 'main' ? 0 : -2,
                }}
              >
                <Tooltip title="Pick a color">
                  <Box
                    ref={colorPickerRef}
                    onClick={() => setColorPickerOpen(true)}
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'custom.gray',
                      boxShadow: 1,
                      cursor: 'pointer',
                      bgcolor: editSpeaker ? editSpeaker.color : 'text.primary',
                      '&:hover': {
                        opacity: 0.7,
                      },
                    }}
                  />
                </Tooltip>

                {colorPickerOpen && (
                  <HexColorPicker
                    style={{
                      position: 'absolute',
                      transition: 'all 0.2s ease-in-out',
                      height: colorPickerOpen ? '12rem' : 0,
                      width: colorPickerOpen ? '12rem' : 0,
                      zIndex: colorPickerOpen ? 10 : -1,
                      opacity: colorPickerOpen ? 1 : 0,
                    }}
                    color={editSpeaker.color}
                    onChange={(color) => updateEditSpeaker('color', color)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}

                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    cursor: 'pointer',
                  }}
                >
                  <Checkbox
                    label="Main Character"
                    id="main-character"
                    checked={editSpeaker.type === 'main'}
                    onChange={handleTypeChange}
                  />
                  <InputLabel htmlFor="main-character">
                    <Typography variant="body1">Main Character</Typography>
                  </InputLabel>
                </Box>
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 2,
                  mt: 2,
                }}
              >
                <Button
                  variant="outlined"
                  disabled={isLoading || modalIsLoading}
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  startIcon={<SaveRoundedIcon />}
                  type="submit"
                  loading={isLoading || modalIsLoading}
                  onClick={handleSave}
                >
                  Save
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Modal>
  );
};

export default EditSpeakerModal;
