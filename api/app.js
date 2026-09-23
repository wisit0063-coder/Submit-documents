/**
 * Passenger entry point.
 * cPanel runs this file from the application root; it must be plain JavaScript.
 * Build first: npm run build  (tsc -> dist/)
 */
'use strict';

process.env.TZ = process.env.TZ || 'Asia/Bangkok';

require('dotenv').config();
require('./dist/src/server.js');
