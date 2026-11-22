# Renders the app icon from the Dirección ghost's 3D model (Blender, Cycles).
# Args after `--`: out roughness specular bg(hex|none) center_z ortho_scale [center_x]
# The icon (iOS, web) was made with:
#   blender -b -P render.py -- icon-t.png 0.8 0.15 none 0.5 1.3 0
#   magick icon-t.png -background '#0b0b0f' -flatten -alpha off icon.png
# The Android adaptive foreground (visible in its centre 2/3) with:
#   blender -b -P render.py -- adaptive-foreground.png 0.8 0.15 none 0.5 1.95 0
# favicon.png is icon.png at 48x48.
# logo.png (the sign-in screen's logo) is the adaptive foreground's centre 560px, at 384:
#   magick adaptive-foreground.png -gravity center -crop 560x560+0+0 +repage -resize 384x384 logo.png
import bpy, sys, math
argv=sys.argv[sys.argv.index("--")+1:]
out, rough, spec, bg, zc, size = argv[0], float(argv[1]), float(argv[2]), argv[3], float(argv[4]), float(argv[5]); xc=float(argv[6]) if len(argv)>6 else 0.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/powervaro/githubs/ghostaff-ai/app/apps/mobile/assets/ghosts/base.glb")
m=bpy.data.materials[0]; nt=m.node_tree; b=nt.nodes["Principled BSDF"]
for l in list(b.inputs["Roughness"].links)+list(b.inputs["Metallic"].links): nt.links.remove(l)
b.inputs["Roughness"].default_value=rough; b.inputs["Metallic"].default_value=0
for k in ("Specular IOR Level","Specular"):
    if k in b.inputs: b.inputs[k].default_value=spec
if "Coat Weight" in b.inputs: b.inputs["Coat Weight"].default_value=0
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.samples=96; sc.cycles.device='CPU'
sc.render.resolution_x=sc.render.resolution_y=1024
sc.render.film_transparent=(bg=="none")
sc.view_settings.view_transform='Standard'
w=bpy.data.worlds.new("w"); sc.world=w; w.use_nodes=True
bgc=(0,0,0) if bg=="none" else tuple(int(bg[i:i+2],16)/255 for i in (0,2,4))
w.node_tree.nodes["Background"].inputs[0].default_value=(*[c**2.2 for c in bgc],1)
w.node_tree.nodes["Background"].inputs[1].default_value=0.0
def light(name,loc,energy,sz):
    d=bpy.data.lights.new(name,'AREA'); d.energy=energy; d.size=sz
    o=bpy.data.objects.new(name,d); sc.collection.objects.link(o); o.location=loc
    c=o.constraints.new('TRACK_TO'); c.target=tgt; c.track_axis='TRACK_NEGATIVE_Z'; c.up_axis='UP_Y'
tgt=bpy.data.objects.new("t",None); sc.collection.objects.link(tgt); tgt.location=(0,0,zc)
light("key",(-1.2,-2.5,2.0),180,3.0)
light("fill",(1.5,-2.0,0.8),80,3.0)
light("rim",(0,2,2),120,2.0)
cd=bpy.data.cameras.new("c"); cd.type='ORTHO'; cd.ortho_scale=size
cam=bpy.data.objects.new("c",cd); sc.collection.objects.link(cam); cam.location=(xc,-5,zc); cam.rotation_euler=(math.pi/2,0,0); sc.camera=cam
sc.render.filepath=out; bpy.ops.render.render(write_still=True)
