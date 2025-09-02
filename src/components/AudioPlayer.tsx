import { useRef, useEffect, useState } from "react"
import { useAudioContext } from "@/contexts/AudioContext"
import { persistentAudioPlayer } from "@/lib/PersistentAudioPlayer"
import DitheredBackground from "./DitheredBackground"

interface AudioPlayerProps {
  src: string
  title: string
  artist: string
  trackId?: string // Add trackId for listen tracking
  listenCount?: number // Add listen count to display
  onTrackEnd?: () => void
  onNextTrack?: () => void
  onPrevTrack?: () => void
  hasNextTrack?: boolean
  hasPrevTrack?: boolean
  currentTrackIndex?: number
  totalTracks?: number
  autoPlay?: boolean
  releaseId?: string // Add releaseId to identify the source
}

export default function AudioPlayer({ 
  src, 
  title, 
  artist, 
  trackId,
  listenCount,
  onTrackEnd,
  onNextTrack,
  onPrevTrack,
  hasNextTrack = false,
  hasPrevTrack = false,
  currentTrackIndex,
  totalTracks,
  autoPlay = false,
  releaseId = "unknown"
}: AudioPlayerProps) {
  const progressRef = useRef<HTMLDivElement>(null)
  // Create consistent player ID based on trackId or src to maintain identity across pages
  const playerIdRef = useRef<string>(`player-${trackId || src.split('/').pop()?.split('.')[0] || 'unknown'}`)
  
  const [hasUserInteracted, setHasUserInteracted] = useState(false)
  const [listenTracked, setListenTracked] = useState(false) // Track if we've recorded a listen for this track

  const audioContext = useAudioContext()

  // Check if this player is the active one
  const isActive = audioContext.isActivePlayer(playerIdRef.current)

  // Function to track a listen
  const trackListen = async () => {
    if (!trackId || listenTracked) return
    
    try {
      const response = await fetch(`/api/tracks/${trackId}/listen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })
      
      if (response.ok) {
        setListenTracked(true)
        console.log('Listen tracked for track:', trackId)
      }
    } catch (error) {
      console.error('Failed to track listen:', error)
    }
  }

  // Check if we should track a listen based on current time and duration
  const shouldTrackListen = (currentTime: number, duration: number): boolean => {
    if (listenTracked || !trackId || duration === 0) return false
    
    // Track after 30 seconds OR 25% of track duration, whichever is shorter
    const thirtySeconds = 30
    const twentyFivePercent = duration * 0.25
    const threshold = Math.min(thirtySeconds, twentyFivePercent)
    
    return currentTime >= threshold
  }

  // Register control callbacks when this player becomes active
  useEffect(() => {
    if (audioContext.isActivePlayer(playerIdRef.current)) {
      audioContext.setPlayerToggleCallback(togglePlayPause, restartTrack, seekToTime);
      audioContext.setTrackControls(hasNextTrack, hasPrevTrack, onNextTrack, onPrevTrack);
    }
  }, [audioContext, hasNextTrack, hasPrevTrack, onNextTrack, onPrevTrack]);

  // Check if this player should be active based on the current track
  useEffect(() => {
    const currentActiveTrack = audioContext.activeTrack
    
    // Don't try to take over if the persistent player is already playing something different
    if (!persistentAudioPlayer.isPaused() && persistentAudioPlayer.getCurrentTime() > 0) {
      const currentSrc = persistentAudioPlayer.getCurrentSource()
      if (currentSrc && currentSrc !== src) {
        console.log('🎮 Persistent player is playing different track, not taking over')
        return // Don't interfere with ongoing playback of a different track
      }
    }
    
    if (currentActiveTrack && currentActiveTrack.src === src) {
      // Only take over if we're not already the active player
      if (!audioContext.isActivePlayer(playerIdRef.current)) {
        console.log('🎮 Registering matching track as active player:', playerIdRef.current, src)
        // Update the active player ID to this component since it's the same track
        const trackInfo = {
          src,
          title,
          artist,
          releaseId,
          trackIndex: currentTrackIndex || 0,
          playerId: playerIdRef.current
        }
        audioContext.setActivePlayer(playerIdRef.current, trackInfo)
        // Always set the track ID for matching track registration
        audioContext.setCurrentTrackId(trackId || null)
      }
      
      // Always update callbacks for the active player showing this track
      audioContext.setPlayerToggleCallback(togglePlayPause, restartTrack, seekToTime)
      audioContext.setTrackControls(hasNextTrack, hasPrevTrack, onNextTrack, onPrevTrack)
    }
  }, [src, title, artist, releaseId, currentTrackIndex, trackId, hasNextTrack, hasPrevTrack, onNextTrack, onPrevTrack])

  // Don't clear active player on unmount - let the audio context handle it naturally

  // Track listen when playing via persistent player
  useEffect(() => {
    if (!isActive || !audioContext.isGloballyPlaying) return
    
    const currentTime = audioContext.currentTime
    const duration = audioContext.duration
    
    // Check if we should track a listen
    if (shouldTrackListen(currentTime, duration)) {
      setListenTracked(true) // Set this immediately to prevent duplicates
      trackListen()
    }
  }, [audioContext.currentTime, audioContext.duration, audioContext.isGloballyPlaying, isActive, listenTracked])

  // Reset listen tracking when track changes
  useEffect(() => {
    setListenTracked(false)
  }, [src])

  // Handle src changes - update persistent player if this is the active player
  useEffect(() => {
    if (isActive) {
      console.log('🎮 Active player src changed, updating persistent player:', src)
      
      // Don't interfere if persistent player is already playing something different
      if (!persistentAudioPlayer.isPaused() && persistentAudioPlayer.getCurrentTime() > 0) {
        const currentSrc = persistentAudioPlayer.getCurrentSource()
        if (currentSrc && currentSrc !== src) {
          console.log('🎮 Persistent player busy with different track, not updating')
          return
        }
      }
      
      const wasPlaying = audioContext.isGloballyPlaying
      const currentSrc = audioContext.activeTrack?.src
      
      // Only update if the source is actually different
      if (currentSrc !== src) {
        console.log('🎮 Source changed from', currentSrc, 'to', src)
        
        // Update the audio context with new track info
        const trackInfo = {
          src,
          title,
          artist,
          releaseId,
          trackIndex: currentTrackIndex || 0,
          playerId: playerIdRef.current
        }
        
        audioContext.setActivePlayer(playerIdRef.current, trackInfo)
        audioContext.setCurrentTrackId(trackId || null)
        
        // AudioContext.setActivePlayer() handles setSource() call
        // Don't call persistentAudioPlayer.setSource(src) here to avoid restart
        
        // Continue playing if it was playing before
        if (wasPlaying) {
          console.log('🎮 Continuing playback after track change')
          persistentAudioPlayer.play().catch(error => {
            console.log('🎮 Auto-play after track change failed:', error)
          })
        }
      } else {
        console.log('🎮 Source unchanged, skipping update')
      }
    }
  }, [src, isActive, title, artist, releaseId, currentTrackIndex, trackId])

  const togglePlayPause = () => {
    const isCurrentlyPlaying = isActive && audioContext.isGloballyPlaying
    console.log('🔄 togglePlayPause called - isActive:', isActive, 'isGloballyPlaying:', audioContext.isGloballyPlaying)

    // Mark that user has interacted with the player
    setHasUserInteracted(true)

    if (isCurrentlyPlaying) {
      console.log('🔄 Pausing audio via persistent player')
      persistentAudioPlayer.pause()
    } else {
      console.log('🔄 Starting playback via persistent player')
      // Set this as the active player FIRST
      const trackInfo = {
        src,
        title,
        artist,
        releaseId,
        trackIndex: currentTrackIndex || 0,
        playerId: playerIdRef.current
      }
      
      audioContext.setActivePlayer(playerIdRef.current, trackInfo, true)
      // Always set the track ID when user clicks play (intentional action)
      audioContext.setCurrentTrackId(trackId || null)
      audioContext.setPlayerToggleCallback(togglePlayPause, restartTrack, seekToTime)
      audioContext.setTrackControls(hasNextTrack, hasPrevTrack, onNextTrack, onPrevTrack)
      
      // Then start playing via persistent player
      persistentAudioPlayer.play().catch(error => {
        console.log("🔄 Persistent play prevented:", error)
      })
    }
  }

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const progressBar = progressRef.current
    if (!progressBar) return

    // If this player is not active, switch to this track instead of seeking
    if (!isActive) {
      console.log('🎯 Switching to inactive player:', playerIdRef.current)
      togglePlayPause() // This will set this player as active and start playing
      return
    }

    if (!displayDuration) return

    const rect = progressBar.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = clickX / rect.width
    const newTime = percentage * displayDuration
    
    console.log('🎯 AudioPlayer progress bar clicked - seeking to:', newTime, 'displayDuration:', displayDuration)
    
    // Use the same protected seeking logic as the now playing bar
    seekToTime(newTime)
  }

  const handleProgressTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    // Only handle touchend to avoid multiple calls during drag
    if (e.type !== 'touchend') return
    
    const progressBar = progressRef.current
    if (!progressBar) return

    // Prevent scrolling and other touch behaviors
    e.preventDefault()
    
    // If this player is not active, switch to this track instead of seeking
    if (!isActive) {
      console.log('📱 Switching to inactive player via touch:', playerIdRef.current)
      togglePlayPause() // This will set this player as active and start playing
      return
    }

    if (!displayDuration) return
    
    const rect = progressBar.getBoundingClientRect()
    const touch = e.changedTouches[0] // Use changedTouches for touchend
    const touchX = touch.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, touchX / rect.width)) // Clamp between 0 and 1
    const newTime = percentage * displayDuration
    
    console.log('📱 AudioPlayer progress bar touched - seeking to:', newTime, 'displayDuration:', displayDuration)
    
    // Add a small delay to ensure touch events are fully processed
    setTimeout(() => {
      seekToTime(newTime)
    }, 10)
  }

  const handleNext = () => {
    console.log('🔄 Next button clicked - isActive:', isActive, 'hasNextTrack:', hasNextTrack, 'onNextTrack:', !!onNextTrack)
    
    if (isActive) {
      // Use global next track if this is the active player
      audioContext.nextTrack?.()
    } else if (onNextTrack && hasNextTrack) {
      // Fallback to local callback for inactive players
      setHasUserInteracted(true)
      onNextTrack()
    }
  }

  const handlePrev = () => {
    console.log('🔄 Prev button clicked - isActive:', isActive, 'hasPrevTrack:', hasPrevTrack, 'onPrevTrack:', !!onPrevTrack)
    
    if (isActive) {
      // Use global prev track if this is the active player
      audioContext.prevTrack?.()
    } else if (onPrevTrack && hasPrevTrack) {
      // Fallback to local callback for inactive players
      setHasUserInteracted(true)
      onPrevTrack()
    }
  }

  const restartTrack = () => {
    console.log('🔄 Restarting track via persistent player')
    persistentAudioPlayer.setCurrentTime(0)
    setHasUserInteracted(true)
  }

  const seekToTime = (time: number) => {
    console.log('🎯 seekToTime via persistent player - seeking to:', time)
    
    // Use persistent player for seeking
    persistentAudioPlayer.setCurrentTime(time)
    setHasUserInteracted(true)
  }

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00"
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Use global audio context progress when this is the active player
  const displayCurrentTime = isActive ? audioContext.currentTime : 0
  const displayDuration = isActive ? audioContext.duration : 0
  const progressPercentage = displayDuration > 0 ? (displayCurrentTime / displayDuration) * 100 : 0

  return (
    <div className="subtle-dither" style={{ 
      border: '1px solid #ccc', 
      padding: '8px', 
      backgroundColor: '#f9f9f9',
      fontFamily: 'Courier New, monospace',
      position: 'relative',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }}>


      {/* Track Info */}
      <div style={{ 
        fontSize: '12px', 
        marginBottom: '8px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <strong>{title}</strong>
          <br />
          <span style={{ color: '#666' }}>
            by {artist}{listenCount !== undefined && ` • ${listenCount} plays`}
          </span>
        </div>
        {currentTrackIndex !== undefined && totalTracks !== undefined && totalTracks > 1 && (
          <div style={{ fontSize: '11px', color: '#666' }}>
            Track {currentTrackIndex + 1} of {totalTracks}
          </div>
        )}
      </div>

      {/* Main Controls */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px',
        marginBottom: '6px'
      }}>
        {/* Previous Button */}
        {(hasNextTrack || hasPrevTrack) && (
          <button
            onClick={handlePrev}
            disabled={!hasPrevTrack}
            style={{
              padding: '4px 6px',
              fontSize: '10px',
              backgroundColor: hasPrevTrack ? '#ddd' : '#f0f0f0',
              color: hasPrevTrack ? '#000' : '#999',
              border: '2px outset #ddd',
              cursor: hasPrevTrack ? 'pointer' : 'not-allowed',
              fontFamily: 'Courier New, monospace'
            }}
            title="Previous track"
          >
            {'<<'}
          </button>
        )}

        {/* Play/Pause Button */}
        <button
          className="play-pause-btn elegant-dither"
          onClick={togglePlayPause}
          style={{
            padding: '6px 12px',
            fontSize: '14px',
            backgroundColor: '#e8e8e8',
            color: '#000',
            border: '1px solid #bbb',
            cursor: 'pointer',
            fontFamily: 'Courier New, monospace',
            minWidth: '60px',
            transition: 'all 0.1s ease'
          }}
        >
          {isActive && audioContext.isGloballyPlaying ? '||' : '>'}
        </button>

        {/* Next Button */}
        {(hasNextTrack || hasPrevTrack) && (
          <button
            onClick={handleNext}
            disabled={!hasNextTrack}
            style={{
              padding: '4px 6px',
              fontSize: '10px',
              backgroundColor: hasNextTrack ? '#ddd' : '#f0f0f0',
              color: hasNextTrack ? '#000' : '#999',
              border: '2px outset #ddd',
              cursor: hasNextTrack ? 'pointer' : 'not-allowed',
              fontFamily: 'Courier New, monospace'
            }}
            title="Next track"
          >
            {'>>'}
          </button>
        )}

        {/* Time Display */}
        <div style={{ 
          fontSize: '11px', 
          color: '#666',
          marginLeft: 'auto',
          fontFamily: 'Courier New, monospace'
        }}>
          {formatTime(displayCurrentTime)} / {formatTime(displayDuration)}
        </div>
      </div>

      {/* Progress Bar */}
      <div 
        ref={progressRef}
        onClick={handleProgressClick}
        onTouchEnd={handleProgressTouch}
        className="subtle-dither"
        style={{
          height: '16px',
          backgroundColor: '#f5f5f5',
          border: '1px solid #ccc',
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '2px'
        }}
      >
        {/* Progress Fill */}
        <div
          className="elegant-dither"
          style={{
            height: '100%',
            width: `${progressPercentage}%`,
            backgroundColor: '#666',
            transition: 'width 0.1s ease'
          }}
        />
        
        {/* Vertical tick marks */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 8px, rgba(0,0,0,0.1) 8px, rgba(0,0,0,0.1) 9px)',
            pointerEvents: 'none'
          }}
        />
      </div>

    </div>
  )
}
