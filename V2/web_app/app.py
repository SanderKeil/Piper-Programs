#!/usr/bin/env python3
# -*-coding:utf8-*-
import sys
import os
import time
import logging
import math
import threading

# Add local libs directory to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), 'libs'))
from flask import Flask, render_template, request, jsonify
from piper_sdk import *
from piper_sdk.kinematics.piper_fk import C_PiperForwardKinematics

app = Flask(__name__)
piper = None
# Global state for background heartbeat
target_mode = 0x00 # 0x00: Standby, 0x01: CAN Control
app_running = True
# Synchronization
heartbeat_lock = threading.Lock()
# Dynamic config: [ctrl_mode, move_mode, speed]
# Default: CAN Control (0x01), Joint Mode (0x01), Speed 50, Gripper Enable (0x01)
current_move_config = {"ctrl_mode": 0x01, "move_mode": 0x01, "speed": 50, "gripper_code": 0x01}

# Global Targets (Integer units as per SDK)
target_joints = [0, 0, 0, 0, 0, 0]
target_end_pose = [0, 0, 0, 0, 0, 0]
target_gripper = 0

@app.route('/api/current_state', methods=['GET'])
def get_current_state():
    global piper
    if not piper:
        return jsonify({'success': False, 'message': 'Robot not connected'})
    
    try:
        # Get Joint States (0.001 degrees)
        joint_msgs = piper.GetArmJointMsgs()
        joints = joint_msgs.joint_state
        
        # Get End Pose (0.001 mm/deg)
        pose_msgs = piper.GetArmEndPoseMsgs()
        pose = pose_msgs.end_pose

        # Get Gripper State (0.001 mm)
        gripper_msgs = piper.GetArmGripperMsgs()
        gripper_state = gripper_msgs.gripper_state

        # Get StatusWrapper
        status_wrapper = piper.GetArmStatus()
        status_msg = status_wrapper.arm_status

        # Handle Enums safely
        ctrl_mode = status_msg.ctrl_mode.value if hasattr(status_msg.ctrl_mode, 'value') else status_msg.ctrl_mode
        arm_status = status_msg.arm_status.value if hasattr(status_msg.arm_status, 'value') else status_msg.arm_status

        return jsonify({
            'success': True,
            'joints': {
                'j1': joints.joint_1 / 1000.0,
                'j2': joints.joint_2 / 1000.0,
                'j3': joints.joint_3 / 1000.0,
                'j4': joints.joint_4 / 1000.0,
                'j5': joints.joint_5 / 1000.0,
                'j6': joints.joint_6 / 1000.0
            },
            'gripper': gripper_state.grippers_angle / 1000.0, # Convert to mm? Or keep as is? SDK doc says 0.001mm.
            'end_pose': {
                'x': pose.X_axis / 1000.0,
                'y': pose.Y_axis / 1000.0,
                'z': pose.Z_axis / 1000.0,
                'rx': pose.RX_axis / 1000.0,
                'ry': pose.RY_axis / 1000.0,
                'rz': pose.RZ_axis / 1000.0
            },
            'meta': {
                'ctrl_mode': ctrl_mode,
                'arm_status': arm_status
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/enable_can', methods=['POST'])
def enable_can_control():
    """Switches the robot to CAN Control Mode (0x01) with feedback verification."""
    global piper, target_mode, target_joints, target_end_pose, target_gripper, current_move_config
    if not piper:
        return jsonify({"success": False, "message": "Robot not connected"})
    
    timeout = 3.0
    start_time = time.time()
    
    # 1. PAUSE Heartbeat
    target_mode = 0x00 
    time.sleep(0.1)

    # 1. PAUSE Heartbeat
    target_mode = 0x00 
    time.sleep(0.1)

    try:
        # Check if already enabled (Teaching Mode)
        # We need to read the low speed msgs to check driver status
        # Note: This might be slightly stale but usually fine.
        low_speed_msgs = piper.GetArmLowSpdInfoMsgs()
        m1 = low_speed_msgs.motor_1.foc_status.driver_enable_status
        m2 = low_speed_msgs.motor_2.foc_status.driver_enable_status
        m3 = low_speed_msgs.motor_3.foc_status.driver_enable_status
        m4 = low_speed_msgs.motor_4.foc_status.driver_enable_status
        m5 = low_speed_msgs.motor_5.foc_status.driver_enable_status
        m6 = low_speed_msgs.motor_6.foc_status.driver_enable_status
        
        already_enabled = m1 and m2 and m3 and m4 and m5 and m6
        
        if already_enabled:
            print("Robot already enabled (active). Skipping re-enable sequence.")
            # Still need to clear flags/errors to allow mode switch from Teaching to CAN
            piper.MotionCtrl_1(0x00, 0x00, 0x00)
            
            # Robust Re-Enable: Loop until confirmed enabled
            re_enable_timeout = 2.0
            re_enable_start = time.time()
            re_enabled = False
            
            while time.time() - re_enable_start < re_enable_timeout:
                piper.EnableArm(7)
                time.sleep(0.05)
                
                # Check status
                ls = piper.GetArmLowSpdInfoMsgs()
                m1 = ls.motor_1.foc_status.driver_enable_status
                m2 = ls.motor_2.foc_status.driver_enable_status
                m3 = ls.motor_3.foc_status.driver_enable_status
                m4 = ls.motor_4.foc_status.driver_enable_status
                m5 = ls.motor_5.foc_status.driver_enable_status
                m6 = ls.motor_6.foc_status.driver_enable_status
                
                if m1 and m2 and m3 and m4 and m5 and m6:
                    re_enabled = True
                    break
            
            if not re_enabled:
                 return jsonify({"success": False, "message": "Failed to re-enable motors after clearing flags"}), 500
        else:
            # 2. Clear Flags
            piper.MotionCtrl_1(0x00, 0x00, 0x00)
            time.sleep(0.05)
            
            # 3. Enable Motors (Loop until enabled)
            enable_timeout = 2.0
            enable_start = time.time()
            is_enabled = False
            
            while time.time() - enable_start < enable_timeout:
                piper.EnableArm(7)
                time.sleep(0.05)
                
                # Check directly from loop
                low_speed_msgs = piper.GetArmLowSpdInfoMsgs()
                m1 = low_speed_msgs.motor_1.foc_status.driver_enable_status
                m2 = low_speed_msgs.motor_2.foc_status.driver_enable_status
                m3 = low_speed_msgs.motor_3.foc_status.driver_enable_status
                m4 = low_speed_msgs.motor_4.foc_status.driver_enable_status
                m5 = low_speed_msgs.motor_5.foc_status.driver_enable_status
                m6 = low_speed_msgs.motor_6.foc_status.driver_enable_status
                
                if m1 and m2 and m3 and m4 and m5 and m6:
                    is_enabled = True
                    break
            
            if not is_enabled:
                 return jsonify({"success": False, "message": "Failed to enable motors (Driver Status Check Failed)"}), 500

        # 4. Sync State (Now that we are enabled, encoders should be valid)
        # Read Joint States
        joint_msgs = piper.GetArmJointMsgs()
        joints = joint_msgs.joint_state
        
        # SANITY CHECK: prevent zero-reading (unless it's actually 0, but all of them 0 is suspicious for a robot in non-zero pose)
        # Just check if everything is EXACTLY zero?
        if joints.joint_1 == 0 and joints.joint_2 == 0 and joints.joint_3 == 0 and \
           joints.joint_4 == 0 and joints.joint_5 == 0 and joints.joint_6 == 0:
             print("WARNING: All joints read as 0. Suspicious state.")
             # Retrying once might help if it just woke up?
             time.sleep(0.1)
             joint_msgs = piper.GetArmJointMsgs()
             joints = joint_msgs.joint_state
        
        target_joints = [
            joints.joint_1, joints.joint_2, joints.joint_3,
            joints.joint_4, joints.joint_5, joints.joint_6
        ]
        # Read End Pose
        pose_msgs = piper.GetArmEndPoseMsgs()
        pose = pose_msgs.end_pose
        target_end_pose = [
            pose.X_axis, pose.Y_axis, pose.Z_axis,
            pose.RX_axis, pose.RY_axis, pose.RZ_axis
        ]
        # Read Gripper
        gripper_msgs = piper.GetArmGripperMsgs()
        target_gripper = gripper_msgs.gripper_state.grippers_angle
        
        print(f"Synced targets: J={target_joints}")

        # 5. Reset Move Config to safe defaults (Joint Mode)
        current_move_config["ctrl_mode"] = 0x01
        current_move_config["move_mode"] = 0x01
        current_move_config["speed"] = 20 # Slower start to prevent jerk
        current_move_config["gripper_code"] = 0x01 # Normal Enable

        # FORCE Mode Switch once before heartbeat takes over
        # This kickstarts the transition from Standby (0) to CAN (1)
        piper.MotionCtrl_2(0x01, 0x01, 20, 0x00)
        
        # Burst Gripper Clean: Send 0x02 (Disable/Clear) then 0x03 (Enable/Clear)
        # This is critical to wake up a stuck gripper
        for _ in range(3):
            piper.GripperCtrl(abs(target_gripper), 1000, 0x02, 0)
            time.sleep(0.01)
        for _ in range(5):
             piper.GripperCtrl(abs(target_gripper), 1000, 0x03, 0)
             time.sleep(0.01)

        # LATE RE-SYNC: Re-read joints one last time to minimize drift
        joint_msgs = piper.GetArmJointMsgs()
        target_joints = [
            joint_msgs.joint_state.joint_1, joint_msgs.joint_state.joint_2, joint_msgs.joint_state.joint_3,
            joint_msgs.joint_state.joint_4, joint_msgs.joint_state.joint_5, joint_msgs.joint_state.joint_6
        ]
        
        time.sleep(0.02)

        # 6. RESUME Heartbeat
        target_mode = 0x01
        
        # 7. Wait for Mode Switch
        mode_timeout = 2.0
        mode_start = time.time()
        
        while time.time() - mode_start < mode_timeout:
            # Check Status
            status_wrapper = piper.GetArmStatus()
            status_msg = status_wrapper.arm_status
            ctrl_mode = status_msg.ctrl_mode.value if hasattr(status_msg.ctrl_mode, 'value') else status_msg.ctrl_mode
            
            print(f"DEBUG: Waiting for CAN Mode (0x01). Current: {ctrl_mode}")

            if ctrl_mode == 0x01:
                return jsonify({"success": True, "message": "Successfully switched to CAN Control Mode"})
            
            time.sleep(0.05)
        
        # Ensure heartbeat resumes even on timeout
        target_mode = 0x01
        return jsonify({"success": False, "message": f"Timeout: Robot enabled but did not switch to CAN Control Mode. Last Mode: {ctrl_mode}"}), 504

    except Exception as e:
        target_mode = 0x01
        return jsonify({'success': False, 'message': str(e)}), 500

def heartbeat_loop():
    global piper, target_mode, app_running, current_move_config
    global target_joints, target_end_pose, target_gripper
    print("Heartbeat thread started")
    hb_count = 0
    while app_running:
        if piper and target_mode == 0x01:
            try:
                # 1. Send Mode/Speed
                c_mode = current_move_config["ctrl_mode"]
                m_mode = current_move_config["move_mode"]
                spd = current_move_config["speed"]
                
                piper.MotionCtrl_2(c_mode, m_mode, spd, 0x00)

                # 2. Send Motion Command based on Mode
                if m_mode == 0x01: # Joint Mode
                    piper.JointCtrl(*target_joints)
                elif m_mode == 0x00: # End Pose Mode
                    piper.EndPoseCtrl(*target_end_pose)
                elif m_mode == 0x02: # Linear Mode (Move L)
                    piper.EndPoseCtrl(*target_end_pose)
                
                # 3. Send Gripper Command
                g_code = current_move_config.get("gripper_code", 0x01)
                piper.GripperCtrl(abs(target_gripper), 1000, g_code, 0)
                
                # DEBUG PROBE (Every ~1 second)
                hb_count += 1
                if hb_count % 50 == 0:
                    # Read status to see if we are actually in CAN mode
                    status_wrapper = piper.GetArmStatus()
                    status = status_wrapper.arm_status
                    raw_mode = status.ctrl_mode.value if hasattr(status.ctrl_mode, 'value') else status.ctrl_mode
                    
                    # Also check enable status
                    ls = piper.GetArmLowSpdInfoMsgs()
                    drv_en = ls.motor_1.foc_status.driver_enable_status
                    
                    print(f"HB DEBUG: Mode={raw_mode} | Enabled={drv_en} | TargJ={target_joints[0]}")
                
            except Exception as e:
                print(f"Heartbeat error: {e}")
        time.sleep(0.02) # 50Hz heartbeat
    print("Heartbeat thread stopped")

def init_piper():
    global piper
    global target_joints, target_end_pose, target_gripper
    try:
        piper = C_PiperInterface_V2("can0")
        piper.ConnectPort()
        piper.EnableArm(7)
        # Give it a moment to enable
        time.sleep(1)
        
        # Initialize targets from current state to prevent jumping
        # Read Joint States
        joint_msgs = piper.GetArmJointMsgs()
        joints = joint_msgs.joint_state
        target_joints = [
            joints.joint_1, joints.joint_2, joints.joint_3,
            joints.joint_4, joints.joint_5, joints.joint_6
        ]

        # Read End Pose
        pose_msgs = piper.GetArmEndPoseMsgs()
        pose = pose_msgs.end_pose
        target_end_pose = [
            pose.X_axis, pose.Y_axis, pose.Z_axis,
            pose.RX_axis, pose.RY_axis, pose.RZ_axis
        ]

        # Read Gripper
        gripper_msgs = piper.GetArmGripperMsgs()
        target_gripper = gripper_msgs.gripper_state.grippers_angle

        print(f"Initialized targets: J={target_joints}, P={target_end_pose}, G={target_gripper}")

        return True
    except Exception as e:
        print(f"Error initializing piper: {e}")
        return False

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/move', methods=['POST'])
def move_robot():
    global piper, target_end_pose, current_move_config
    if not piper:
        return jsonify({'success': False, 'message': 'Robot not connected'})

    try:
        data = request.json
        # Convert inputs (mm/deg) to robot units (x1000)
        x = int(float(data.get('x', 0)) * 1000)
        y = int(float(data.get('y', 0)) * 1000)
        z = int(float(data.get('z', 0)) * 1000)
        rx = int(float(data.get('rx', 0)) * 1000)
        ry = int(float(data.get('ry', 0)) * 1000)
        rz = int(float(data.get('rz', 0)) * 1000)
        
        # Update Target
        target_end_pose = [x, y, z, rx, ry, rz]

        # Position control mode (0x01 CAN, 0x00 End Pose)
        # Update heartbeat config first so it doesn't fight us
        current_move_config["ctrl_mode"] = 0x01
        current_move_config["move_mode"] = 0x00
        # Read speed from request, default to 100 if not provided
        speed_req = int(data.get('speed', 100))
        # Clamp speed 0-100
        speed_req = max(0, min(100, speed_req))
        current_move_config["speed"] = speed_req
        
        # NOTE: Actual command sending is now handled by heartbeat_loop
        
        return jsonify({'success': True, 'message': 'Command sent'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/joints')
def joints():
    return render_template('joints.html')

@app.route('/api/move_joints', methods=['POST'])
def move_robot_joints():
    global piper, target_joints, current_move_config
    if not piper:
        return jsonify({'success': False, 'message': 'Robot not connected'})

    try:
        data = request.json
        # Convert inputs (deg) to robot units (0.001 deg)
        # Integers required
        j1 = int(float(data.get('j1', 0)) * 1000)
        j2 = int(float(data.get('j2', 0)) * 1000)
        j3 = int(float(data.get('j3', 0)) * 1000)
        j4 = int(float(data.get('j4', 0)) * 1000)
        j5 = int(float(data.get('j5', 0)) * 1000)
        j6 = int(float(data.get('j6', 0)) * 1000)
        
        # Update Target
        target_joints = [j1, j2, j3, j4, j5, j6]

        # Handling modes
        move_mode = int(data.get('move_mode', 0x01)) # Default 0x01 Joint
        end_pose_in = data.get('end_pose')
        
        if move_mode == 0x02 and end_pose_in and len(end_pose_in) == 6:
             # Convert MM/Deg to 0.001 units
             global target_end_pose
             target_end_pose = [int(float(v)*1000) for v in end_pose_in]
             print(f"Set Linear Target: {target_end_pose}")

        # Update heartbeat config
        current_move_config["ctrl_mode"] = 0x01
        current_move_config["move_mode"] = move_mode
        
        # Read speed from request, default to 50 if not provided
        speed_req = int(data.get('speed', 50))
        # Clamp speed 0-100
        speed_req = max(0, min(100, speed_req))
        current_move_config["speed"] = speed_req

        # NOTE: Actual command sending is now handled by heartbeat_loop
        
        return jsonify({'success': True, 'message': 'Joint command sent'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/move_gripper', methods=['POST'])
def move_gripper():
    global piper, target_gripper
    if not piper:
        return jsonify({'success': False, 'message': 'Robot not connected'})

    try:
        data = request.json
        gripper = int(data.get('gripper', 0))
        
        # Scale: Input 0-100 (mm) -> SDK 0.001mm units
        # e.g. 50mm -> 50000
        gripper_um = gripper * 1000
        
        # Update Target
        target_gripper = gripper_um
        
        # Reset Gripper Code to 0x01 (Standard Enable) after explicit move
        current_move_config["gripper_code"] = 0x01
        
        # NOTE: Actual command sending is now handled by heartbeat_loop
        
        return jsonify({'success': True, 'message': 'Gripper command sent'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500



@app.route('/api/status', methods=['GET'])
def status():
    # Placeholder for status reading if we want to implement it later
    return jsonify({'success': True, 'status': 'connected'})

if __name__ == '__main__':
    if init_piper():
        print("Robot connected. Starting server...")
        # Start heartbeat thread
        t = threading.Thread(target=heartbeat_loop, daemon=True)
        t.start()
    else:
        print("WARNING: Robot not connected. Starting server anyway.")
    
    app.run(host='0.0.0.0', port=5000, debug=True)
