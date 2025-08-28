import React, { useState, useEffect } from 'react';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import algoliasearch from 'algoliasearch/lite';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useUser } from '../../context/UserProvider';
import { useStorySense } from '../../context/StorySenseProvider';
import { useNavigate } from 'react-router-dom';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import { Box, Stack, TextField, Typography } from '@mui/material';
import './Search.css';
import ArticleIcon from '@mui/icons-material/Article';
import {
  TRANSCRIPTS_INDEXNAME,
  SPEAKERS_INDEXNAME,
  client as algolia,
} from '../../../algolia-config.js';
import Logger from '../../util/logger';

export function highlightText(text, searchValue) {
  if (!searchValue.trim()) return text;
  const regex = new RegExp(`(${searchValue})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

function SuperSearch() {
  const { currentUser } = useUser();
  const { currentProjectId } = useStorySense();
  const navigate = useNavigate();
  const algoliaSearchOnlyApiKey = 'ABCDEFGHIJKLMNOP';
  const algoliaAppId = '12345';

  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState({
    transcripts: [],
    speakers: [],
    myMedia: [],
  });
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState('transcripts');
  const [searchResultsCount, setSearchResultsCount] = useState({
    transcripts: 0,
    speakers: 0,
    myMedia: 0,
  });
  const [searchIndex, setSearchIndex] = useState(null);

  useEffect(() => {
    if (currentUser?.uid) {
      const transcriptIndex = algolia.initIndex(TRANSCRIPTS_INDEXNAME);
      const speakerIndex = algolia.initIndex(SPEAKERS_INDEXNAME);
      setSearchIndex({ transcriptIndex, speakerIndex });
    }
  }, [currentUser?.uid]);

  useEffect(() => {
    const fetchResults = async () => {
      if (searchValue.trim() && currentUser?.uid && currentProjectId) {
        setSearching(true);
        try {
          const [transcriptHits, speakerHits, myMediaHits] = await Promise.all([
            searchIndex.transcriptIndex.search(searchValue, {
              filters: `projectID:${currentProjectId}`,
            }),
            searchIndex.speakerIndex.search(searchValue, {
              filters: `projectID:${currentProjectId}`,
            }),
            window.electron.videoAnalysis.fuzzySearch({
              searchTerm: searchValue,
              projectId: currentProjectId,
              fireBaseUserIdToken: await currentUser.getIdToken(),
            }),
          ]);
          setSearchResultsCount({
            transcripts: transcriptHits.nbHits,
            speakers: speakerHits.nbHits,
            myMedia: myMediaHits.length,
          });
          setSearchResults({
            transcripts: transcriptHits.hits,
            speakers: speakerHits.hits,
            myMedia: myMediaHits,
          });
        } catch (err) {
          Logger.error('Search failed', {
            searchTerm: searchValue,
            error: err.message || 'Unknown error',
          });
          setSearchResults({ transcripts: [], speakers: [], myMedia: [] });
        } finally {
          setSearching(false);
        }
      } else {
        setSearchResults({ transcripts: [], speakers: [], myMedia: [] });
        setSearching(false);
      }
    };

    fetchResults();
  }, [searchValue, searchIndex, currentUser, currentProjectId]);

  const navigateAndOpenTranscript = (jobName, startTime, endTime) => {
    Logger.debug('Navigating to transcript from search', {
      jobName,
      startTime,
      endTime,
    });
    setSearchValue('');
    navigate(
      `/story-builder?transcript=${jobName}&startTime=${startTime}&endTime=${endTime}`,
    );
  };

  const navigateAndOpenSpeaker = (speaker) => {
    Logger.debug('Navigating to character from search', {
      speakerId: speaker.objectID,
      speakerName: speaker.name,
    });
    setSearchValue('');
    navigate(`/characters`);
  };

  const navigateAndOpenMyMedia = (media) => {
    Logger.debug('Navigating to media from search', {
      mediaId: media.video_id,
      mediaName: media.video_name || media.videoName,
      searchTerm: searchValue,
    });
    setSearchValue('');
    navigate(
      `/mymedia?videoId=${media.video_id}&searchTerm=${encodeURIComponent(searchValue)}`,
    );
  };

  return (
    <Box
      sx={{
        width: searchValue ? '100%' : 300,
        transition: 'width 0.3s',
      }}
    >
      <TextField
        placeholder="Search..."
        fullWidth
        size="small"
        sx={{
          marginTop: searchValue ? 1 : 0,
          '&:focus': {
            boxShadow: 4,
          },

          '& .MuiInputBase-root': {
            bgcolor: 'custom.translucentAppbarBg',
            color: 'custom.white',
            p: '0.3rem 1rem',
            borderTopLeftRadius: 2,
            borderTopRightRadius: 2,
            '& input': {},
          },

          '& input::placeholder': {
            color: 'custom.white',
            opacity: 1,
          },

          '& .MuiInput-underline:before': {
            borderBottom: 'none',
          },

          '& .MuiInput-underline:after': {
            borderBottom: 'none',
          },

          '& .MuiInput-underline:hover:not(.Mui-disabled):before': {
            borderBottom: 'none',
          },
        }}
        slotProps={{
          input: {
            endAdornment: searchValue && (
              <CloseRoundedIcon
                sx={{ cursor: 'pointer' }}
                fontSize="medium"
                onClick={() => setSearchValue('')}
              />
            ),
          },
        }}
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        variant="standard"
      />
      <Box
        sx={{
          bgcolor: 'background.paper',
          width: '100%',
          position: 'relative',
          boxShadow: 4,
          maxHeight: '85dvh',
          overflowY: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderBottomLeftRadius: 4,
          borderBottomRightRadius: 4,
        }}
      >
        {searchResults.transcripts.length > 0 ||
        searchResults.speakers.length > 0 ||
        searchResults.myMedia.length > 0 ? (
          <>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 2,
                p: 1,
                position: 'absolute',
                width: '100%',
                backdropFilter: 'blur(5px)',
                bgcolor: 'transparent',
                zIndex: 2,
                boxShadow: 2,

                '& > *': {
                  cursor: 'pointer',
                  padding: 1,
                  borderRadius: 1,
                  '&:hover': {
                    bgcolor: 'custom.gray',
                  },
                },
              }}
            >
              <Typography
                variant="h6"
                color="text.primary"
                sx={{
                  bgcolor:
                    activeTab === 'transcripts'
                      ? 'custom.gray'
                      : 'background.paper',
                }}
                onClick={() => setActiveTab('transcripts')}
              >
                Transcripts ({searchResultsCount.transcripts || 0})
              </Typography>

              <Typography
                variant="h6"
                color="text.primary"
                sx={{
                  bgcolor:
                    activeTab === 'myMedia'
                      ? 'custom.gray'
                      : 'background.paper',
                }}
                onClick={() => setActiveTab('myMedia')}
              >
                MyMedia ({searchResultsCount.myMedia || 0})
              </Typography>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', paddingTop: 6 }}>
              {activeTab === 'transcripts' &&
              searchResults.transcripts.length > 0 ? (
                <List>
                  {searchResults.transcripts.map((result) => (
                    <ListItem key={result.objectID}>
                      <div
                        className="search-result-row"
                        onClick={() =>
                          navigateAndOpenTranscript(
                            result.JobName,
                            result.startTime,
                            result.endTime,
                          )
                        }
                      >
                        <div className="search-result-content">
                          <Stack
                            justifyContent={'space-between'}
                            alignItems={'center'}
                            direction="row"
                            spacing={1}
                            mb={1}
                          >
                            <span
                              className="search-result-speaker"
                              style={{ color: result.speakerColor }}
                            >
                              {result.name}
                            </span>
                            <div className="search-result-time">
                              {result.startTime} - {result.endTime}
                            </div>
                          </Stack>

                          <Typography
                            variant="body2"
                            component="span"
                            sx={{
                              color: 'text.primary',
                            }}
                            dangerouslySetInnerHTML={{
                              __html: highlightText(
                                result.content,
                                searchValue,
                              ),
                            }}
                          />
                        </div>
                        <div className="search-result-footer">
                          {/* <div className="search-result-file-name">
                            <RecordVoiceOverIcon
                              style={{ width: 14, height: 12, marginRight: 2 }}
                            />
                            {result.FileName}
                          </div> */}
                        </div>
                      </div>
                    </ListItem>
                  ))}
                </List>
              ) : activeTab === 'speakers' &&
                searchResults.speakers.length > 0 ? (
                <List>
                  {searchResults.speakers.map((result) => (
                    <ListItem key={result.objectID}>
                      <div
                        className="search-result-row"
                        onClick={() => navigateAndOpenSpeaker(result)}
                      >
                        <div className="search-result-content">
                          <div className="speaker-search-row-name">
                            <div
                              className="speaker-ball"
                              style={{
                                height: 10,
                                width: 10,
                                borderRadius: '50%',
                                backgroundColor: result.color,
                              }}
                            ></div>
                            <span
                              className="search-result-speaker"
                              style={{ fontSize: 16 }}
                            >
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: highlightText(
                                    result.name,
                                    searchValue,
                                  ),
                                }}
                              />
                              <span>#{result.objectID.slice(0, 5)}</span>
                            </span>
                          </div>
                          <div className="speaker-transcripts">
                            {result.JobNames &&
                              result.JobNames.length > 0 &&
                              result.JobNames.map((job, index) => (
                                <React.Fragment key={index}>
                                  {job.filename && (
                                    <div className="search-result-file-name">
                                      <RecordVoiceOverIcon
                                        style={{
                                          width: 14,
                                          height: 12,
                                          marginRight: 2,
                                        }}
                                      />
                                      {job.filename}
                                    </div>
                                  )}
                                </React.Fragment>
                              ))}
                          </div>
                        </div>
                      </div>
                    </ListItem>
                  ))}
                </List>
              ) : activeTab === 'myMedia' &&
                searchResults.myMedia.length > 0 ? (
                <List sx={{ width: '100%', bgcolor: 'background.paper' }}>
                  {searchResults.myMedia.map((result) => (
                    <ListItem
                      key={result.objectId || result.video_id}
                      alignItems="flex-start"
                      sx={{
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: 'rgba(0, 0, 0, 0.04)',
                        },
                        padding: '12px',
                        borderBottom: '1px solid #e0e0e0',
                      }}
                      onClick={() => navigateAndOpenMyMedia(result)}
                    >
                      <Box sx={{ display: 'flex', width: '100%' }}>
                        <Box
                          component="img"
                          src={
                            result.first_frame_signed_url ||
                            '/path/to/placeholder-image.jpg'
                          }
                          alt={result.video_name || result.videoName}
                          sx={{
                            width: 150,
                            height: 84,
                            objectFit: 'cover',
                            marginRight: 2,
                            flexShrink: 0,
                          }}
                        />
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            flexGrow: 1,
                          }}
                        >
                          <Typography
                            component="span"
                            variant="subtitle1"
                            color="text.primary"
                            sx={{ fontWeight: 'bold', marginBottom: 0.5 }}
                            dangerouslySetInnerHTML={{
                              __html: highlightText(
                                result.video_name || result.videoName,
                                searchValue,
                              ),
                            }}
                          />
                          <Typography
                            component="span"
                            variant="body2"
                            color="text.secondary"
                            dangerouslySetInnerHTML={{
                              __html: highlightText(
                                result.description_summary ||
                                  result.description,
                                searchValue,
                              ),
                            }}
                          />
                        </Box>
                      </Box>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    p: 2,
                    mt: 1,
                    color: 'text.primary',
                  }}
                >
                  <SearchOffIcon />
                  <Typography variant="h6" sx={{ textAlign: 'center' }}>
                    No results found
                  </Typography>
                </Box>
              )}
            </Box>
          </>
        ) : (
          <>
            {searchValue ? (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  p: 2,
                  color: 'text.primary',
                }}
              >
                {searching ? (
                  <Typography variant="h6">Searching...</Typography>
                ) : (
                  <>
                    <SearchOffIcon />
                    <Typography variant="h6" sx={{ textAlign: 'center' }}>
                      No results found
                    </Typography>
                  </>
                )}
              </Box>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
}

export default SuperSearch;
