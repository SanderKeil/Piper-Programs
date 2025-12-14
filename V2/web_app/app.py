#!/usr/bin/env python3
# -*-coding:utf8-*-
import sys
import os
import time
import logging
import math

# Add local libs directory to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), 'libs'))
from flask import Flask, render_template, request, jsonify
from piper_sdk import *
from piper_sdk.kinematics.piper_fk import C_PiperForwardKinematics

app = Flask(__name__)
piper = None

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
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

def init_piper():
    global piper
    try:
        piper = C_PiperInterface_V2("can0")
        piper.ConnectPort()
        piper.EnableArm(7)
        # Give it a moment to enable
        time.sleep(1)
        return True
    except Exception as e:
        print(f"Error initializing piper: {e}")
        return False

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/move', methods=['POST'])
def move_robot():
    global piper
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
        # Position control mode
        piper.MotionCtrl_2(0x01, 0x00, 100, 0x00)
        
        # Send command
        piper.EndPoseCtrl(x, y, z, rx, ry, rz)
        
        return jsonify({'success': True, 'message': 'Command sent'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/joints')
def joints():
    return render_template('joints.html')

@app.route('/api/move_joints', methods=['POST'])
def move_robot_joints():
    global piper
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
        # Joint control mode (0x01 CAN Ctrl, 0x01 MOVE J)
        # Note: MotionCtrl_2(ctrl_mode, move_mode, speed, ...)
        piper.MotionCtrl_2(0x01, 0x01, 50, 0x00)
        
        # Send command
        piper.JointCtrl(j1, j2, j3, j4, j5, j6)
        
        return jsonify({'success': True, 'message': 'Joint command sent'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/move_gripper', methods=['POST'])
def move_gripper():
    global piper
    if not piper:
        return jsonify({'success': False, 'message': 'Robot not connected'})

    try:
        data = request.json
        gripper = int(data.get('gripper', 0))
        
        # Scale: Input 0-100 (mm) -> SDK 0.001mm units
        # e.g. 50mm -> 50000
        gripper_um = gripper * 1000

        # Gripper control (1000 = speed/effort?, 0x01 enable)
        # Using 0x01 (Enable)
        piper.GripperCtrl(abs(gripper_um), 1000, 0x01, 0)
        
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
    else:
        print("WARNING: Robot not connected. Starting server anyway.")
    
    app.run(host='0.0.0.0', port=5000, debug=True)
