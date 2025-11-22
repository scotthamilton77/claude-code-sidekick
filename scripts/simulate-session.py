#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

def resolve_transcript_path(session_id_or_path):
    """Resolves the transcript path from a session ID or file path."""
    if os.path.exists(session_id_or_path):
        return os.path.abspath(session_id_or_path)
    
    # Try to find by session ID in ~/.claude/projects
    projects_dir = os.path.expanduser("~/.claude/projects")
    for root, dirs, files in os.walk(projects_dir):
        if f"{session_id_or_path}.jsonl" in files:
            return os.path.join(root, f"{session_id_or_path}.jsonl")
            
    raise FileNotFoundError(f"Could not find transcript for '{session_id_or_path}'")

def get_countdown_reset_value(confidence):
    """Calculates the countdown reset value based on confidence score."""
    if confidence < 0.6:
        return 5
    elif confidence < 0.8:
        return 10
    else:
        return 20

def run_analysis(transcript_path, line_number, output_dir):
    """Runs the analyze-session-at-line.sh script."""
    script_path = os.path.join(os.getcwd(), "scripts/analyze-session-at-line.sh")
    cmd = [
        script_path,
        transcript_path,
        "--to-line", str(line_number),
        "--output-dir", output_dir
    ]
    
    print(f"[{line_number}] Triggering analysis...")
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error running analysis at line {line_number}: {e.stderr}")
        return False

def get_latest_confidence(session_id, output_dir, line_number):
    """Reads the latest confidence score from the generated session summary."""
    # Format line number to 4 digits (e.g. 0100)
    line_str = f"{line_number:04d}"
    summary_path = os.path.join(output_dir, session_id, f"{line_str}-session-summary.json")
    
    if not os.path.exists(summary_path):
        print(f"Warning: Summary file not found at {summary_path}")
        return 0.0
        
    try:
        with open(summary_path, 'r') as f:
            data = json.load(f)
            # Use session_title_confidence as the primary metric
            return data.get('session_title_confidence', 0.0)
    except Exception as e:
        print(f"Error reading session summary: {e}")
        return 0.0

def main():
    parser = argparse.ArgumentParser(description="Simulate session analysis from a transcript.")
    parser.add_argument("session_id_or_path", help="Session ID or path to transcript file")
    parser.add_argument("--start-line", type=int, default=0, help="Line number to start simulation from")
    parser.add_argument("--output-dir", help="Directory for analysis artifacts")
    
    args = parser.parse_args()
    
    try:
        transcript_path = resolve_transcript_path(args.session_id_or_path)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        sys.exit(1)
        
    print(f"Using transcript: {transcript_path}")
    
    # Determine session ID from filename
    session_id = os.path.splitext(os.path.basename(transcript_path))[0]
    
    # Set default output dir if not provided
    if not args.output_dir:
        args.output_dir = os.path.join("test-data", "session-analysis")
        
    # Initialize state
    countdown_title = 0
    countdown_intent = 0
    
    # Read transcript
    with open(transcript_path, 'r') as f:
        lines = f.readlines()
        
    i = 0
    while i < len(lines):
        line_num = i + 1
        
        if line_num < args.start_line:
            i += 1
            continue
            
        try:
            entry = json.loads(lines[i])
        except json.JSONDecodeError:
            print(f"Skipping invalid JSON at line {line_num}")
            i += 1
            continue
            
        # Check for User Prompt (contiguous block)
        if entry.get('type') == 'user' and 'tool_result' not in str(entry.get('message', {}).get('content', '')):
            # Look ahead for more user prompts
            last_prompt_line = line_num
            j = i + 1
            while j < len(lines):
                try:
                    next_entry = json.loads(lines[j])
                    if next_entry.get('type') == 'user' and 'tool_result' not in str(next_entry.get('message', {}).get('content', '')):
                        last_prompt_line = j + 1
                        j += 1
                    else:
                        break
                except json.JSONDecodeError:
                    break
            
            # Trigger analysis at the end of the user prompt block
            print(f"[{last_prompt_line}] User Prompt detected (block end)")
            if run_analysis(transcript_path, last_prompt_line, args.output_dir):
                confidence = get_latest_confidence(session_id, args.output_dir, last_prompt_line)
                reset_val = get_countdown_reset_value(confidence)
                countdown_title = reset_val
                countdown_intent = reset_val
                print(f"[{last_prompt_line}] Analysis complete. Confidence: {confidence}. Countdowns reset to {reset_val}")
            
            i = j # Skip processed lines
            continue

        # Check for Tool Result
        if entry.get('type') == 'user' and 'tool_result' in str(entry.get('message', {}).get('content', '')):
            # Count tool results in this line (could be multiple)
            content = str(entry.get('message', {}).get('content', ''))
            tool_count = content.count('tool_result')
            
            for _ in range(tool_count):
                countdown_title -= 1
                countdown_intent -= 1
                
                if countdown_title <= 0 or countdown_intent <= 0:
                    print(f"[{line_num}] Tool Result triggered analysis (Countdowns: Title={countdown_title}, Intent={countdown_intent})")
                    if run_analysis(transcript_path, line_num, args.output_dir):
                        confidence = get_latest_confidence(session_id, args.output_dir, line_num)
                        reset_val = get_countdown_reset_value(confidence)
                        countdown_title = reset_val
                        countdown_intent = reset_val
                        print(f"[{line_num}] Analysis complete. Confidence: {confidence}. Countdowns reset to {reset_val}")
                    break # Only trigger once per line if multiple tools finish? 
                          # Actually, if multiple tools finish, we might want to trigger once.
                          # But the logic says "on post tool use", so technically per tool.
                          # For simplicity and likely behavior, triggering once per line if threshold met is safer for now, 
                          # but let's stick to the loop to be precise if needed. 
                          # However, analyze-session-at-line is idempotent for the same line. 
                          # So calling it multiple times for the same line is wasteful.
                          # Let's break after first trigger on this line.
            
        i += 1

if __name__ == "__main__":
    main()
