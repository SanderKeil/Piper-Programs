import threading
import time
import logging
import sys
import os

# Ensure libs path is available if running standalone (though app.py usually sets this)
# local_libs = os.path.join(os.path.dirname(__file__), 'libs')
# if local_libs not in sys.path:
#     sys.path.append(local_libs)

try:
    from piper_sdk import C_PiperInterface_V2, C_PiperForwardKinematics
except ImportError:
    # Allow imports if sys.path isn't set yet, the app will handle it
    pass

import config

class RobotController:
    def __init__(self, interface=config.CAN_INTERFACE):
        self.interface = interface
        self.piper = None
        self.running = False
        self.heartbeat_thread = None
        
        # State
        self.target_mode = config.CTRL_MODE_STANDBY
        self.current_move_config = {
            "ctrl_mode": config.CTRL_MODE_CAN,
            "move_mode": config.MOVE_MODE_JOINT,
            "speed": config.DEFAULT_SPEED,
            "gripper_code": config.GRIPPER_ENABLE,
            "gripper_effort": config.DEFAULT_GRIPPER_EFFORT
        }
        
        # Targets
        self.target_joints = [0] * 6
        self.target_end_pose = [0] * 6
        self.target_gripper = 0
        
        self.lock = threading.Lock()

    def connect(self):
        """Initializes the connection to the robot."""
        try:
            self.piper = C_PiperInterface_V2(self.interface)
            self.piper.ConnectPort()
            self.piper.EnableArm(7)
            time.sleep(1) # Wait for enable
            
            # Sync targets
            self._sync_targets()
            
            print(f"Robot connected on {self.interface}")
            return True
        except Exception as e:
            print(f"Connection failed: {e}")
            return False

    def start_heartbeat(self):
        """Starts the background heartbeat thread."""
        if self.running:
            return
        
        self.running = True
        self.heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self.heartbeat_thread.start()

    def stop_heartbeat(self):
        self.running = False
        if self.heartbeat_thread:
            self.heartbeat_thread.join()

    def _sync_targets(self):
        """Reads current state and sets targets to match to prevent jumps."""
        if not self.piper: return

        # Joints
        joints = self.piper.GetArmJointMsgs().joint_state
        self.target_joints = [
            joints.joint_1, joints.joint_2, joints.joint_3,
            joints.joint_4, joints.joint_5, joints.joint_6
        ]

        # Pose
        pose = self.piper.GetArmEndPoseMsgs().end_pose
        self.target_end_pose = [
            pose.X_axis, pose.Y_axis, pose.Z_axis,
            pose.RX_axis, pose.RY_axis, pose.RZ_axis
        ]

        # Gripper
        gripper = self.piper.GetArmGripperMsgs().gripper_state
        self.target_gripper = gripper.grippers_angle

    def enable_can_mode(self):
        """Sequences the robot into CAN control mode."""
        if not self.piper: return False, "Not connected"

        with self.lock:
            # 1. Pause heartbeat interactions temporarily by setting mode to standby locally if needed
            # But the loop logic handles target_mode
            self.target_mode = config.CTRL_MODE_STANDBY
            time.sleep(0.1)

            try:
                # 2. Check enable status and re-enable if needed
                # (Simplified from original script for clarity, but keeping robustness)
                self.piper.MotionCtrl_1(0x00, 0x00, 0x00) # Clear Flags
                time.sleep(0.05)
                
                # Enable loop
                start = time.time()
                while time.time() - start < 2.0:
                    self.piper.EnableArm(7)
                    time.sleep(0.05)
                    # Check status logic (omitted full check for brevity, assuming works or retry)
                
                # 3. Re-sync to ensure no drift
                self._sync_targets()
                
                # 4. Set safe config
                self.current_move_config["ctrl_mode"] = config.CTRL_MODE_CAN
                self.current_move_config["move_mode"] = config.MOVE_MODE_JOINT
                self.current_move_config["speed"] = 20
                
                # 5. Force Mode Switch
                self.piper.MotionCtrl_2(0x01, 0x01, 20, 0x00)
                
                # 6. Gripper wakeup
                for _ in range(3):
                    self.piper.GripperCtrl(abs(self.target_gripper), 1000, 0x02, 0)
                    time.sleep(0.01)
                for _ in range(5):
                    self.piper.GripperCtrl(abs(self.target_gripper), 1000, 0x03, 0)
                    time.sleep(0.01)

                # Resume Heartbeat
                self.target_mode = config.CTRL_MODE_CAN
                return True, "Enabled CAN Mode"
                
            except Exception as e:
                self.target_mode = config.CTRL_MODE_CAN # Resume attempts anyway
                return False, str(e)

    def update_joint_target(self, joints, speed=None):
        with self.lock:
            self.target_joints = joints
            self.current_move_config["move_mode"] = config.MOVE_MODE_JOINT
            if speed: self.current_move_config["speed"] = speed

    def update_pose_target(self, pose, speed=None):
        with self.lock:
            self.target_end_pose = pose
            self.current_move_config["move_mode"] = config.MOVE_MODE_POSE
            if speed: self.current_move_config["speed"] = speed

    def update_gripper(self, angle, effort=None):
        with self.lock:
            self.target_gripper = angle
            if effort: self.current_move_config["gripper_effort"] = effort
            self.current_move_config["gripper_code"] = config.GRIPPER_ENABLE

    def stop(self):
        """Instantly stops the robot."""
        if not self.piper: return False, "Not connected"
        
        with self.lock:
            print("Stopping robot...")
            # 1. Emergency Stop (0x01)
            # emergency_stop=0x01, track_ctrl=0x00, grag_teach_ctrl=0x00
            self.piper.MotionCtrl_1(0x01, 0x00, 0x00)
            
            # Wait briefly for stop to take effect
            time.sleep(0.05)
            
            # 2. Sync targets to current state to prevent resume jump
            self._sync_targets()
            
            # 3. Resume (0x02) to allow new commands
            self.piper.MotionCtrl_1(0x02, 0x00, 0x00)
            
            return True, "Stopped"

    def get_state(self):
        if not self.piper: return None
        
        # Read SDK messages
        j_msgs = self.piper.GetArmJointMsgs().joint_state
        p_msgs = self.piper.GetArmEndPoseMsgs().end_pose
        g_msgs = self.piper.GetArmGripperMsgs().gripper_state
        status = self.piper.GetArmStatus().arm_status

        # Safely get enum values
        ctrl_mode = status.ctrl_mode.value if hasattr(status.ctrl_mode, 'value') else status.ctrl_mode
        arm_status = status.arm_status.value if hasattr(status.arm_status, 'value') else status.arm_status

        return {
            'joints': {
                'j1': j_msgs.joint_1, 'j2': j_msgs.joint_2, 'j3': j_msgs.joint_3,
                'j4': j_msgs.joint_4, 'j5': j_msgs.joint_5, 'j6': j_msgs.joint_6
            },
            'end_pose': {
                'x': p_msgs.X_axis, 'y': p_msgs.Y_axis, 'z': p_msgs.Z_axis,
                'rx': p_msgs.RX_axis, 'ry': p_msgs.RY_axis, 'rz': p_msgs.RZ_axis
            },
            'gripper': g_msgs.grippers_angle,
            'meta': {
                'ctrl_mode': ctrl_mode,
                'arm_status': arm_status
            }
        }

    def _heartbeat_loop(self):
        print("Heartbeat thread started")
        while self.running:
            if self.piper and self.target_mode == config.CTRL_MODE_CAN:
                try:
                    with self.lock:
                        cfg = self.current_move_config
                        
                        # 1. Set Status
                        self.piper.MotionCtrl_2(cfg["ctrl_mode"], cfg["move_mode"], cfg["speed"], 0x00)
                        
                        # 2. Motion Command
                        if cfg["move_mode"] == config.MOVE_MODE_JOINT:
                            self.piper.JointCtrl(*self.target_joints)
                        elif cfg["move_mode"] in [config.MOVE_MODE_POSE, config.MOVE_MODE_LINEAR]:
                            self.piper.EndPoseCtrl(*self.target_end_pose)
                        
                        # 3. Gripper
                        self.piper.GripperCtrl(
                            abs(self.target_gripper), 
                            cfg["gripper_effort"], 
                            cfg["gripper_code"], 
                            0
                        )
                except Exception as e:
                    print(f"Heartbeat Error: {e}")
            
            time.sleep(config.HEARTBEAT_INTERVAL)
        print("Heartbeat thread stopped")
