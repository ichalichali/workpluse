#!/bin/bash
echo "================================================"
echo "  WorkPulse - Attendance & Leave Management"
echo "================================================"
echo ""
echo "Starting server..."
cd "$(dirname "$0")"
python app.py
