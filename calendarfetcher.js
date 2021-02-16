/*jshint node: true */
'use strict';

/* Magic Mirror
 * Node Helper: GoogleCalendar - CalendarFetcher
 *
 * By Luís Gomes
 * MIT Licensed.
 *
 * Updated by @asbjorn
 * - rewrote to follow the nodejs samples from Google Calendar API
 */

const moment = require( 'moment' ),
    fs = require( 'fs' ),
    readline = require( 'readline' ),
    { google } = require( 'googleapis' );

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'],
    TOKEN_DIR = __dirname + '/.credentials/',
    GOOGLE_API_CONFIG_PATH = TOKEN_DIR + 'client_secret.json',
    TOKEN_PATH = TOKEN_DIR + 'calendar-credentials.json';

class CalendarFetcher {
    constructor( calendarName, reloadInterval, maximumEntries, maximumNumberOfDays ) {
        this.calendarName = calendarName;
        this.reloadInterval = reloadInterval;
        this.maximumEntries = maximumEntries;
        this.maximumNumberOfDays = maximumNumberOfDays;

        this.oAuth2Client = null;
        this.reloadTimer = null;
        this.events = [];
    }

    fetchFailedCallback() {

    }

    eventsReceivedCallback() {

    }

    fetchCalendar() {
        console.log( "Fetching calendar events.." );

        // Load client secrets from a local file.
        try {
            //const content = fs.readFileSync(TOKEN_PATH);
            const content = fs.readFileSync( GOOGLE_API_CONFIG_PATH );
            this.authorize( JSON.parse( content ) );
        } catch( err ) {
            console.log( 'Error loading client secret file:', err );
        }
    }

    /* scheduleTimer()
     * Schedule the timer for the next update.
     */
    scheduleTimer() {
        console.log( 'Schedule update timer.' );
        if( this.reloadTimer !== null )
            clearTimeout( this.reloadTimer );

        this.events = [];
        this.fetchCalendar();

        this.reloadTimer = setTimeout( ( ) => { this.scheduleTimer( ); }, this.reloadInterval );
    }

    /* isFullDayEvent(event)
     * Checks if an event is a fullday event.
     *
     * argument event obejct - The event object to check.
     *
     * return bool - The event is a fullday event.
     */
    isFullDayEvent( event ) {
        if( event.start.date )
            return true;

        const start = event.start.dateTime || 0;
        const startDate = new Date( start );
        const end = event.end.dateTime || 0;

        return end - start === 24 * 60 * 60 * 1000 && startDate.getHours() === 0 && startDate.getMinutes() === 0;
    }

    /**
     * Create an OAuth2 client with the given credentials, and then execute the
     * given callback function.
     *
     * @param {Object} credentials The authorization client credentials.
     */
    authorize( credentials ) {
        const { client_secret, client_id, redirect_uris } = credentials.web;
        let token = {};

        this.oAuth2Client = new google.auth.OAuth2( client_id, client_secret, redirect_uris[ 0 ] );

        // Check if we have previously stored a token.
        try {
            token = fs.readFileSync( TOKEN_PATH );
        } catch( err ) {
            return this.getNewToken( );
        }

        this.oAuth2Client.setCredentials( JSON.parse( token ) );
        this.createCalendar( );
    }

    /**
     * Create and returns a Promise object that retrieves, filters and properly
     * packs the Google Calendar events.
     */
     createCalendar( ) {
        const calendar = google.calendar( { version: 'v3', auth: this.oAuth2Client } );

        calendar.events.list( {
            calendarId: 'primary',
            timeMin: ( new Date() ).toISOString(),
            maxResults: this.maximumEntries,
            singleEvents: true,
            orderBy: 'startTime',
        }, ( err, res ) => {
            // Error handling
            if( err ) {
                this.fetchFailedCallback( this, err );
                return console.error( err );
            }

            let calendar_events = res.data.items;
            if( calendar_events.length ) {
                calendar_events.map( ( event, i ) => {
                    let start = event.start.dateTime || event.start.date;
                    let today = moment().startOf( 'day' ).toDate();
                    let future = moment().startOf( 'day' ).add( this.maximumNumberOfDays, 'days' ).subtract( 1, 'seconds' ).toDate(); // Subtract 1 second so that events that start on the middle of the night will not repeat.
                    let skip_me = false;

                    let title = '';
                    let fullDayEvent = false;
                    let startDate = undefined;
                    let endDate = undefined;

                    // console.log("event.kind: " + event.kind);
                    if( event.kind === 'calendar#event' ) {
                        startDate = moment( new Date( event.start.dateTime || event.start.date ) );
                        endDate = moment( new Date( event.end.dateTime || event.end.date ) );

                        if( event.start.length === 8 ) {
                            startDate = startDate.startOf( 'day' );
                        }

                        title = event.summary || event.description || 'Event';
                        fullDayEvent = this.isFullDayEvent( event );
                        if( !fullDayEvent && endDate < new Date() ) {
                            console.log( "It's not a fullday event, and it is in the past. So skip: " + title );
                            skip_me = true;
                        }
                        if( fullDayEvent && endDate <= today ) {
                            console.log( "It's a fullday event, and it is before today. So skip: " + title );
                            skip_me = true;
                        }

                        if( startDate > future ) {
                            console.log( "It exceeds the maximumNumberOfDays limit. So skip: " + title );
                            skip_me = true;
                        }
                    } else {
                        console.log( "Other kind of event: ", event );
                    }

                    if( !skip_me ) {
                        // Every thing is good. Add it to the list.
                        console.log( "Adding: " + title );
                        this.events.push( {
                            title: title,
                            startDate: startDate.format( 'x' ),
                            endDate: endDate.format( 'x' ),
                            fullDayEvent: fullDayEvent
                        } );
                    }
                } );

                // Sort the combination of events from all calendars
                this.events.sort( ( a, b ) => {
                    return a.startDate - b.startDate;
                } );

                // Update 'global' events array
                this.events = this.events.slice( 0, this.maximumEntries );

                // Broadcast event and setup re-occurring scheduler
                this.broadcastEvents();
            } else {
                console.log( 'No upcoming events found.' );
            }
        } );
    }
    
    /**
     * Store token to disk be used in later program executions.
     *
     * @param {Object} token The token to store to disk.
     */
    storeToken( token ) {
        try {
            fs.mkdirSync( TOKEN_DIR );
        } catch( err ) {
            if( err.code !== 'EEXIST' )
                throw err;
        }

        fs.writeFile( TOKEN_PATH, JSON.stringify( token ) );
    }

    /**
     * Get and store new token after prompting for user authorization, and then
     * execute the given callback with the authorized OAuth2 client.
     *
     */
    getNewToken( ) {
        console.log( "Getting new token for MMM-googlecalendar" );

        const authUrl = this.oAuth2Client.generateAuthUrl( {
            access_type: 'offline',
            prompt: 'consent',
            scope: SCOPES,
        } );
        console.log( 'Authorize this app by visiting this url:', authUrl );

        const rl = readline.createInterface( {
            input: process.stdin,
            output: process.stdout
        } );

        rl.question( 'Enter the code from that page here: ', ( code ) => {
            rl.close();
            this.oAuth2Client.getToken( decodeURIComponent( code.replace( /\+/g,  " " ) ), ( err, token ) => {
                if( err ) {
                    return console.error( err );
                }

                this.oAuth2Client.setCredentials( token );
                // Store the token to disk for later program executions
                try {
                    fs.writeFileSync( TOKEN_PATH, JSON.stringify( token ) );
                    console.log( 'Token stored to', TOKEN_PATH );
                } catch( err ) {
                    console.error( err );
                }
                this.createCalendar( );
            } );
        } );
    }

    /* public methods */

    /* startFetch()
     * Initiate fetchCalendar();
     */
    startFetch() {
        this.scheduleTimer();
    };

    /* broadcastItems()
     * Broadcast the existing events.
     */
    broadcastEvents() {
        //console.log('Broadcasting ' + events.length + ' events.');
        this.eventsReceivedCallback( this );
    };

    /* onReceive(callback)
     * Sets the on success callback
     *
     * argument callback function - The on success callback.
     */
    onReceive( callback ) {
        this.eventsReceivedCallback = callback;
    };

    /* onError(callback)
     * Sets the on error callback
     *
     * argument callback function - The on error callback.
     */
    onError( callback ) {
        this.fetchFailedCallback = callback;
    };

    /* url()
     * Returns the calendar name of this fetcher.
     *
     * return string - The calendar name of this fetcher.
     */
    name() {
        return this.calendarName;
    };

    /* events()
     * Returns current available events for this fetcher.
     *
     * return array - The current available events for this fetcher.
     */
    getEvents() {
        return this.events;
    };
}

module.exports = CalendarFetcher;
